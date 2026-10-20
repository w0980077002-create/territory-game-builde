"""Offline production-component browser tests. Never talks to the live economy."""
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('/tmp/fortune-screenshots');out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=__import__('shutil').which('chromium') or __import__('shutil').which('google-chrome'),headless=True,args=['--no-sandbox','--allow-file-access-from-files'])
    errors=[]
    for width in [320,360,390,430]:
        page=browser.new_page(viewport={'width':width,'height':844},reduced_motion='reduce')
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('https://**/*',lambda route:route.abort())
        page.goto('file:///tmp/fortune-preview.html')
        spin=page.get_by_role('button',name='КРУТИТЬ — 1 БИЛЕТ',exact=True)
        spin.wait_for()
        page.wait_for_function("!document.querySelector('.fortune-spin').disabled")
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'horizontal overflow'
        for control in page.locator('.fortune-toolbar button,.fortune-spin').all():
            box=control.bounding_box();assert box['width']>=44 and box['height']>=44
            assert box['x']>=0 and box['x']+box['width']<=width
        wheel=page.locator('.fortune-wheel').bounding_box()
        assert wheel['x']>=0 and wheel['x']+wheel['width']<=width
        page.get_by_role('button',name='Правила ?').click()
        dialog=page.get_by_role('dialog');dialog.wait_for()
        assert dialog.locator('tr').count()==12
        assert '0.05%' in dialog.inner_text() and '0.45%' in dialog.inner_text()
        assert '100-го' in dialog.inner_text()
        page.keyboard.press('Escape');assert page.get_by_role('dialog').count()==0
        page.screenshot(path=str(out/f'wheel-{width}.png'),full_page=True)
        # Two immediate DOM clicks must issue one mutation.
        page.locator('.fortune-spin').evaluate('(el)=>{el.click();el.click();}')
        page.get_by_role('dialog').wait_for()
        assert '3 синих самоцвета' in page.get_by_role('dialog').inner_text()
        assert page.evaluate("window.__fortuneCalls.filter(c=>c.p_action==='spin').length")==1
        page.screenshot(path=str(out/f'reward-{width}.png'),full_page=True)
        # A real remount reads the pending server receipt, without a second spin.
        page.locator('#fixture-treasury').evaluate('(el)=>el.click()')
        page.get_by_role('dialog').wait_for()
        assert '3 синих самоцвета' in page.get_by_role('dialog').inner_text()
        page.get_by_role('dialog').get_by_role('button',name='OK',exact=True).click()
        page.wait_for_function("!document.querySelector('.fortune-chests button').disabled")
        golden=page.locator('.fortune-chests button').last
        golden.click();page.get_by_role('dialog').wait_for()
        page.wait_for_function("document.querySelector('.fortune-dialog h3')?.textContent==='100 золота'")
        assert page.evaluate("window.__fortuneCalls.filter(c=>c.p_action==='golden').length")==1
        page.screenshot(path=str(out/f'treasury-{width}.png'),full_page=True)
        page.get_by_role('dialog').get_by_role('button',name='OK',exact=True).click()
        assert '0' in golden.inner_text()
        page.close()
    # Actual 5.2-second animation, stationary pointer, safe animation skip.
    page=browser.new_page(viewport={'width':390,'height':844})
    page.goto('file:///tmp/fortune-preview.html');page.wait_for_function("!document.querySelector('.fortune-spin').disabled")
    pointer=page.locator('.fortune-pointer').bounding_box()
    page.locator('.fortune-spin').click();page.get_by_role('button',name='Пропустить анимацию').wait_for()
    page.wait_for_timeout(350)
    assert page.locator('.fortune-wheel').evaluate("el=>getComputedStyle(el).transform")!='none'
    assert page.get_by_role('dialog').count()==0
    page.get_by_role('button',name='Пропустить анимацию').click()
    page.get_by_role('dialog').wait_for()
    assert page.locator('.fortune-pointer').bounding_box()['x']==pointer['x']
    assert page.evaluate("window.__fortuneCalls.filter(c=>c.p_action==='spin').length")==1
    assert not errors,errors
    browser.close()
print('Wheel browser PASS: 320/360/390/430, rules, exact receipt, double click, remount recovery, golden chest, no overflow, reduced motion and animation skip. Offline fixtures only.')
