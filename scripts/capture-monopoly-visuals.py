"""Real Chromium screenshots of the isolated production component with offline fixtures."""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright
source = Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/monopoly-visual-review.html').resolve()
out = Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/monopoly-screenshots')
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':390,'height':844}, device_scale_factor=1)
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    # External network is forbidden even though the fixture already replaces fetch.
    page.route('https://**/*', lambda route: route.abort())
    page.goto(source.as_uri())
    page.locator('[data-cell-index="27"]').wait_for()
    page.wait_for_function("document.querySelector('.mono-wallet b')?.textContent === '16'")
    page.wait_for_function('document.images.length > 0 && Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)')
    page.wait_for_timeout(1200)
    assert page.locator('[data-cell-index]').count()==28
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow'
    scene=page.locator('.mono-scene').bounding_box()
    for tile in page.locator('[data-cell-index]').all():
        box=tile.bounding_box()
        assert box['x']>=scene['x'] and box['x']+box['width']<=scene['x']+scene['width'], 'tile outside scene'
        assert box['y']>=scene['y'] and box['y']+box['height']<=scene['y']+scene['height'], 'tile outside scene'
    for control in page.locator('.mono-scene-shortcuts button, .mono-dice, .mono-milestones button').all():
        rect=control.bounding_box()
        assert rect is not None and 0<=rect['x'] and rect['x']+rect['width']<=390, 'offscreen horizontal control'
        assert 0<=rect['y'] and rect['y']+rect['height']<=844, 'offscreen vertical control'
    assert page.locator('.mono-cell-number').count()==0, 'second numbered diamond present'
    small_die=page.locator('.mono-dice .mono-dice-perspective').bounding_box()
    tap_die=page.locator('.mono-dice').bounding_box()
    assert small_die and 19<=small_die['width']<=23, 'visual die must be one-third of the original 64px'
    assert tap_die and tap_die['width']>=48 and tap_die['height']>=50, 'keep the small die tappable'
    lap=page.locator('.mono-lap-plaque').bounding_box()
    dice=page.locator('.mono-dice').bounding_box()
    assert lap is not None and dice is not None and lap['y']+lap['height'] < dice['y'], 'lap counter covered by dice'
    page.screenshot(path=str(out/'01-board-390.png'), full_page=True)
    for label,filename in [('Подарки','02-gifts-390.png'),('Задания','03-quests-390.png'),('Награды за круги','04-laps-390.png'),('Спецпредложения','05-offers-390.png')]:
        (page.locator('.mono-milestones button').first if label=='Награды за круги' else page.get_by_role('button',name=label,exact=True)).click()
        page.get_by_role('dialog').wait_for()
        if label=='Награды за круги':
            panel=page.locator('.mono-panel').bounding_box()
            assert panel and panel['width']<=355 and panel['height']<=430, 'lap rewards must be a compact popup'
            assert panel['y']>=110 and panel['y']+panel['height']<=844-75, 'lap popup cannot hide behind Telegram header or bottom nav'
            leave=page.get_by_role('button',name='← В Монополию',exact=True)
            assert leave.is_visible(), 'lap popup must have an obvious return button'
            back=leave.bounding_box()
            assert back and back['y']>=110 and back['y']+back['height']<=844-75, 'return button must stay tappable'
            reward_list=page.locator('.panel-rewards .mono-panel-body')
            assert reward_list.evaluate('(el)=>el.scrollHeight>el.clientHeight'), 'milestone prizes should scroll inside the popup'
        if label in ('Подарки','Задания','Спецпредложения'):
            panel=page.locator('.mono-panel').bounding_box()
            assert panel and panel['width']<=350 and panel['height']<=470, 'compact panel should not cover entire phone'
            assert page.locator('.mono-panel-tabs button').count()==3, 'missing gifts/quests/offers navigation'
            assert page.locator('.mono-panel-status').is_visible(), 'claim state and refresh must be visible'
        page.wait_for_timeout(300)
        if label=='Задания':
            page.locator('[data-testid="daily-share-monopoly"]').wait_for()
            invite=page.locator('[data-testid="daily-share-monopoly"]').get_by_role('button',name='Поделиться в Telegram',exact=True)
            invite.wait_for(state='visible')
            page.wait_for_function("!document.querySelector('[data-testid=daily-share-monopoly] button')?.disabled")
            page.evaluate("""() => {
                window.__capturedInvite=null;
                window.open=(url)=>{window.__capturedInvite=url;return null;};
                if(window.Telegram?.WebApp)window.Telegram.WebApp.openTelegramLink=(url)=>{window.__capturedInvite=url;};
            }""")
            invite.click()
            shared=page.evaluate("window.__capturedInvite")
            from urllib.parse import unquote
            assert shared and shared.startswith('https://t.me/share/url?'), 'share picker failed; debug='+str(page.evaluate("""() => ({
              origin:location.origin, telegram:!!window.Telegram?.WebApp, captured:window.__capturedInvite,
              button:document.querySelector('[data-testid=daily-share-monopoly] button')?.outerHTML,
              alert:document.querySelector('[data-testid=daily-share-monopoly] [role=alert]')?.textContent
            })"""))
            assert 'https://t.me/TestTerritoryBot?startapp=ref_0123456789abcd' in unquote(shared), 'share must contain personal Telegram bot deep link'
            assert 'github.io' not in unquote(shared), 'never send the GitHub Pages URL'

            assert page.locator('.mono-panel .mono-quest button').count()>=3, 'existing three quest actions must remain'
            last_task=page.locator('.mono-panel .mono-quest').last
            last_task.scroll_into_view_if_needed()
            last=last_task.bounding_box()
            assert last and last['y']>=0 and last['y']+last['height']<=844-10, 'quest must be reachable by scrolling compact panel'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(out/filename),full_page=False)
        (page.get_by_role('button',name='← В Монополию',exact=True) if label=='Награды за круги' else page.get_by_role('button',name='Закрыть',exact=True)).click()
        assert page.locator('.mono-overlay').count()==0, 'must return to game board without exiting Telegram'
    page.get_by_role('button',name='Подарки',exact=True).click()
    page.get_by_role('button',name='ЗАБРАТЬ БЕСПЛАТНО',exact=True).click()
    page.get_by_role('heading',name='Сокровище твоё!',exact=True).wait_for()
    page.wait_for_timeout(1100)
    page.screenshot(path=str(out/'06-reward-390.png'),full_page=False)
    page.get_by_role('button',name='ПРОДОЛЖИТЬ',exact=True).click()
    for width,height in [(375,812),(320,740)]:
        page.set_viewport_size({'width':width,'height':height})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(out/f'07-board-{width}.png'),full_page=True)
    assert not errors,errors
    (out/'verification.json').write_text(json.dumps({'renderer':'Chromium / Playwright','fixtures':True,'production_network':False,'cells':28,'widths':[390,375,320],'horizontal_overflow':False,'page_errors':errors,'screenshots':[p.name for p in out.glob('*.png')]},ensure_ascii=False,indent=2))
    browser.close()
print('Real browser screenshots saved to',out)
