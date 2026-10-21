"""Actual production wheel/nav/CSS with offline economy fixtures. No live accounts."""
from pathlib import Path
from urllib.parse import urlparse
import json
import math
import mimetypes
import shutil
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/fortune-screenshots')
OUT.mkdir(exist_ok=True)
ORIGIN = 'http://127.0.0.1:4173'
SLOTS=[11,0,6,8,9,2,3,10,1,5,4,7]
PRIZES = [('gold',100),('gems',1),('gems',3),('gems',5),('potion',1),('elixir',1),('stone',1),('common',1),('rare',1),('golden_key',1),('vip',1),('level',1)]
report={'environment':'Chromium, production components/CSS/navigation; intercepted offline fixture transport','devices':'Desktop mobile viewports; not physical Telegram devices','viewports':[],'landing_sectors':[],'artwork':'Original attachment extracted with masks/retouch, no generated art','bottom_rewards_panel':False}
def serve(route):
    path=urlparse(route.request.url).path
    f=Path('/tmp/fortune-preview.html') if path=='/' else ROOT/'public'/path.lstrip('/')
    assert f.is_file(),f'Missing review asset: {f}'
    route.fulfill(body=f.read_bytes(),content_type='text/html' if path=='/' else mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
def load(browser,width,height,reduced=True,english=False):
    page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce' if reduced else 'no-preference')
    page.route(ORIGIN+'/**',serve)
    page.route('https://**/*',lambda r:r.abort())
    if english:page.add_init_script("localStorage.setItem('territory-language','en')")
    page.goto(ORIGIN+'/')
    page.wait_for_function("!!document.querySelector('.fortune-spin')&&!document.querySelector('.fortune-spin').disabled")
    page.wait_for_function("[...document.images].every(i=>i.complete&&i.naturalWidth>0)")
    return page
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
    errors=[]
    for width,height in [(320,640),(360,700),(390,650),(430,740),(320,568),(430,644),(390,844),(430,844)]:
        page=load(browser,width,height)
        page.on('pageerror',lambda error:errors.append(str(error)))
        spin=page.get_by_role('button',name='КРУТИТЬ — 1 БИЛЕТ',exact=True)
        assert '128' in page.locator('.fortune-ticket').inner_text(),'large existing ticket wallet must work'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'document horizontal overflow'
        assert page.locator('[data-fortune-sector]').count()==12
        for i,(prize,qty) in enumerate(PRIZES):
            sector=page.locator(f'[data-fortune-sector="{i}"]')
            assert sector.get_attribute('data-prize')==prize and sector.get_attribute('data-quantity')==str(qty)
            assert sector.get_attribute('data-angle-slot')==str(SLOTS[i])
        nav=page.locator('.territory-nav').bounding_box()
        box=spin.bounding_box()
        assert box['y']>=0 and box['y']+box['height']<=nav['y'],f'spin obscured on initial {width}x{height}: {box}, nav={nav}'
        for control in page.locator('.fortune-toolbar button,.fortune-spin').all():
            r=control.bounding_box();assert r['width']>=44 and r['height']>=44
            assert r['x']>=0 and r['x']+r['width']<=width
        wheel=page.locator('.fortune-wheel').bounding_box()
        assert wheel['x']>=0 and wheel['x']+wheel['width']<=width and wheel['width']>=270
        pointer=page.locator('.fortune-pointer').bounding_box()
        assert abs(pointer['x']+pointer['width']*(52/108)-wheel['x']-wheel['width']/2)<1
        assert page.locator('.fortune-original-wheel').get_attribute('href').endswith('original-wheel.webp')
        assert page.locator('.fortune-prizes').count()==0
        assert 'Возможные награды' not in page.locator('[data-testid=wheel-of-fortune]').inner_text()
        assert page.locator('.fortune-title').bounding_box()['height']<175,'oversized title'
        # The original stage remains proportional; the former blank black floor
        # must instead be a decoration fitted inside the real Telegram play area.
        scene=page.locator('.fortune-original-scene').bounding_box()
        tail=page.locator('.fortune-scene-tail').bounding_box()
        assert abs(tail['y']-(scene['y']+scene['height']))<2, f'gap below original scene at {width}x{height}'
        assert tail['height']>=0, 'missing ambient floor'
        if height>=740:
            assert tail['height']>35, f'tall phone has no filled floor: {width}x{height}'
            assert abs(tail['y']+tail['height']-nav['y'])<3, f'floor misses persistent navigation at {width}x{height}'
            assert page.locator('.territory-screen').evaluate('el=>el.scrollHeight<=el.clientHeight+3'), f'unexpected scrolling on tall phone {width}x{height}'
        active=page.locator('.territory-nav [aria-current="page"]')
        assert active.count()==1 and active.get_attribute('aria-label')=='Игры'
        battle=page.get_by_role('button',name='Бой',exact=True)
        assert battle.evaluate("el=>getComputedStyle(el).backgroundImage")=='none','inactive Battle blue spotlight'
        assert battle.evaluate("el=>getComputedStyle(el).boxShadow")=='none'
        assert active.evaluate("el=>getComputedStyle(el).backgroundImage")!='none','Games loses approved gold highlight'
        page.screenshot(path=str(OUT/f'wheel-{width}x{height}.png'))
        page.get_by_role('button',name='Правила',exact=True).click()
        dialog=page.get_by_role('dialog');dialog.wait_for()
        assert dialog.locator('tr').count()==12
        assert '0.05%' in dialog.inner_text() and '0.45%' in dialog.inner_text()
        assert dialog.evaluate('(el)=>el.scrollTop')==0,'Rules should open at their beginning'
        db=dialog.bounding_box();assert db['x']>=0 and db['x']+db['width']<=width and db['y']>=0 and db['y']+db['height']<=height
        if width==390:page.screenshot(path=str(OUT/'rules-390.png'))
        page.keyboard.press('Escape')
        # The panel/gallery is entirely gone; Back is a discreet top control.
        back=page.locator('.fortune-back').bounding_box()
        assert back['y']+back['height']<=nav['y']
        # Scroll the entire primary button into view and verify true hit testing.
        spin.scroll_into_view_if_needed()
        assert spin.evaluate('(el)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
        spin.evaluate('(el)=>{el.click();el.click();}')
        page.get_by_role('dialog').wait_for()
        assert '3 синих самоцвета' in page.get_by_role('dialog').inner_text()
        assert page.evaluate("window.__fortuneCalls.filter(c=>c.p_action==='spin').length")==1
        if width==390:page.screenshot(path=str(OUT/'reward-390.png'))
        page.locator('#fixture-treasury').evaluate('(el)=>el.click()')
        page.get_by_role('dialog').wait_for()
        assert '3 синих самоцвета' in page.get_by_role('dialog').inner_text()
        page.get_by_role('dialog').get_by_role('button',name='OK',exact=True).click()
        page.wait_for_function("!document.querySelector('.fortune-chests button').disabled")
        page.locator('.fortune-chests button').last.click()
        page.wait_for_function("document.querySelector('.fortune-dialog h3')?.textContent==='100 золота'")
        assert page.evaluate("window.__fortuneCalls.filter(c=>c.p_action==='golden').length")==1
        page.get_by_role('dialog').get_by_role('button',name='OK',exact=True).click()
        report['viewports'].append({'width':width,'height':height,'wheel_width':wheel['width'],'spin_bottom':box['y']+box['height'],'navigation_top':nav['y'],'horizontal_overflow':False,'active_tab':'Игры'})
        page.close()
    page=load(browser,390,844)
    for index,(prize,quantity) in enumerate(PRIZES):
        page.evaluate('(r)=>window.__fortuneOutcome=r',{'prize':prize,'quantity':quantity})
        page.locator('.fortune-spin').click()
        page.get_by_role('dialog').wait_for()
        matrix=page.locator('.fortune-wheel').evaluate('el=>getComputedStyle(el).transform')
        a,b=[float(x) for x in matrix.removeprefix('matrix(').removesuffix(')').split(',')[:2]]
        angle=math.degrees(math.atan2(b,a))%360
        target=(-SLOTS[index]*30)%360
        assert abs(((angle-target+180)%360)-180)<.01,(index,angle,target)
        report['landing_sectors'].append({'sector':index,'prize':prize,'quantity':quantity,'pointer_alignment_degrees':angle})
        page.get_by_role('dialog').get_by_role('button',name='OK',exact=True).click()
        page.wait_for_function("!document.querySelector('.fortune-spin').disabled")
    # Existing Battle remains blue when actually selected outside the wheel.
    page.evaluate("document.querySelector('.territory-shell').classList.remove('territory-wheel-open')")
    assert 'gradient' in page.get_by_role('button',name='Бой',exact=True).evaluate('el=>getComputedStyle(el).backgroundImage')
    page.close()
    # Non-reduced animation and skip only affect presentation.
    page=load(browser,390,650,reduced=False)
    page.locator('.fortune-spin').click()
    page.get_by_role('button',name='Пропустить анимацию').wait_for()
    page.wait_for_timeout(300)
    assert page.get_by_role('dialog').count()==0
    page.screenshot(path=str(OUT/'wheel-spinning-390.png'))
    assert page.locator('.fortune-wheel').evaluate('el=>getComputedStyle(el).transform')!='none'
    page.get_by_role('button',name='Пропустить анимацию').click()
    page.get_by_role('dialog').wait_for()
    assert page.evaluate("window.__fortuneCalls.filter(c=>c.p_action==='spin').length")==1
    page.close()
    # Let an entire normal animation finish and verify the final confirmed angle.
    page=load(browser,390,844,reduced=False)
    page.locator('.fortune-spin').click()
    page.get_by_role('dialog').wait_for(timeout=8000)
    assert '3 синих самоцвета' in page.get_by_role('dialog').inner_text()
    matrix=page.locator('.fortune-wheel').evaluate('el=>getComputedStyle(el).transform')
    a,b=[float(x) for x in matrix.removeprefix('matrix(').removesuffix(')').split(',')[:2]]
    assert abs((math.degrees(math.atan2(b,a))%360)-180)<.01
    assert page.locator('.fortune-pointer').evaluate('el=>getComputedStyle(el).animationName')=='none'
    page.close()
    page=load(browser,390,844,english=True)
    assert page.locator('.fortune-title>img').get_attribute('src').endswith('original-title.webp')
    page.get_by_role('button',name='Rules',exact=True).click()
    assert page.get_by_role('dialog').locator('tr').count()==12
    page.close()
    # Simulated Telegram/iPhone safe-area variables; no physical device claim.
    page=load(browser,390,650)
    page.evaluate("document.documentElement.style.setProperty('--territory-bottom-inset','34px');document.documentElement.style.setProperty('--territory-top-inset','20px')")
    nav=page.locator('.territory-nav').bounding_box()
    button=page.locator('.fortune-spin').bounding_box()
    assert button['y']>=0 and button['y']+button['height']<=nav['y']
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.locator('.fortune-ticket').bounding_box()['y']>=20
    assert page.locator('.fortune-rules').bounding_box()['y']>=20
    report['simulated_safe_area']={'top':20,'bottom':34,'spin_accessible':True}
    page.screenshot(path=str(OUT/'wheel-safe-area-390.png'))
    page.close()
    assert not errors,errors
    browser.close()
(OUT/'verification.json').write_text(json.dumps(report,indent=2))
print('Wheel browser PASS: eight mobile/short viewports, 128 tickets, all twelve sector mappings and exact landing angles, no obscured Spin button, Games-only gold navigation, no bottom rewards panel, rules/results, remount recovery, golden chest, reduced motion, skip and English. Offline fixtures; not physical-device verification.')
