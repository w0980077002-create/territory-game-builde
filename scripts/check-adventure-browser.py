"""Browser-only smoke: actual adventure React screen with synthetic server data."""
from pathlib import Path
from urllib.parse import urlparse
import os, shutil
from playwright.sync_api import sync_playwright

FILE = Path('/tmp/adventure-preview.html')
URL = 'http://127.0.0.1:4175/'
OUT = Path('/tmp/adventure-screenshots')
OUT.mkdir(exist_ok=True)

def serve(route):
    if urlparse(route.request.url).path == '/':
        route.fulfill(body=FILE.read_bytes(), content_type='text/html')
    else:
        route.fulfill(status=404)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('SLOT_BROWSER_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome'), headless=True, args=['--no-sandbox'])
    errors = []
    for width, height in [(320,568),(360,700),(390,844),(430,740)]:
        page = browser.new_page(viewport={'width':width,'height':height})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.route(URL+'**',serve)
        page.goto(URL)
        page.get_by_test_id('territory-adventure-v1').wait_for()
        page.get_by_test_id('dark-cave-challenge').wait_for()
        floor_panel = page.get_by_test_id('dark-cave-floor-scroll')
        actions = page.get_by_test_id('dark-cave-actions')
        challenge = page.get_by_test_id('dark-cave-challenge')
        assert actions.is_visible() and challenge.is_visible(), 'Challenge must be visible without scrolling main page'
        bounds = page.evaluate("""() => {
          const realm=document.querySelector('[data-testid="dark-cave-realm"]').getBoundingClientRect();
          const list=document.querySelector('[data-testid="dark-cave-floor-scroll"]').getBoundingClientRect();
          const actions=document.querySelector('[data-testid="dark-cave-actions"]').getBoundingClientRect();
          const challenge=document.querySelector('[data-testid="dark-cave-challenge"]').getBoundingClientRect();
          return {realmTop:realm.top, realmBottom:realm.bottom, listTop:list.top, listBottom:list.bottom,
                  actionsTop:actions.top, actionsBottom:actions.bottom, challengeBottom:challenge.bottom,
                  windowHeight:innerHeight};
        }""")
        assert bounds['listBottom'] <= bounds['actionsTop'] + 2, f'Floor list overlaps actions: {bounds}'
        assert bounds['challengeBottom'] <= bounds['windowHeight'] - 60, f'Challenge hidden behind bottom navigation: {bounds}'
        assert floor_panel.evaluate('(e) => e.scrollHeight > e.clientHeight'), '100 floors must be scrollable'
        floor_geometry = page.evaluate("""() => {
          const item = document.querySelector('[data-testid="dark-cave-floor-scroll"]');
          const panel = document.querySelector('[data-testid="dark-cave-floor-list"]');
          return {
            viewport: [innerWidth, innerHeight],
            list_client: item.clientHeight,
            list_offset: item.offsetHeight,
            panel_client: panel.clientHeight,
            panel_offset: panel.offsetHeight,
            list_style: getComputedStyle(item).height,
            panel_style: getComputedStyle(panel).minHeight,
            panel_padding: getComputedStyle(panel).padding,
          };
        }""")
        assert floor_geometry['list_client'] >= 156, f'At least three cave floors must be viewable without scrolling: {floor_geometry}'
        assert page.get_by_test_id('dark-cave-visual').is_visible(), 'Dark abyss illustration must be present'
        assert page.get_by_text('Добавить благословение').count() == 0, 'Unimplemented blessings may not appear as active slots'
        assert page.get_by_text('Режим боя').count() == 0, 'Mode selection belongs in combat, not the cave lobby'
        assert page.get_by_test_id('dark-cave-challenge').count() == 1, 'Exactly one paid Challenge is available'
        assert page.get_by_role('button', name='Мой этаж' if width else 'My floor').count() == 1, 'Current-floor jump must remain available'
        assert page.get_by_test_id('dark-stone-balance').count() == 1, 'Server-authoritative Dark Stone balance must be visible'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow'
        page.screenshot(path=str(OUT / ('adventure-'+str(width)+'.png')), full_page=True)
        if width == 390:
            assert page.get_by_test_id('dark-cave-current-floor').count() == 1
            assert floor_panel.locator('[aria-label*="закрыт"]').count() >= 95, 'locked floors visible in scroll catalog'
            floor_panel.evaluate('(e) => {e.scrollTop = e.scrollHeight}')
            assert floor_panel.evaluate('(e) => e.scrollTop > 0'), 'must scroll beyond initial floors'
            page.get_by_role('button',name='Мой этаж').click()
            assert floor_panel.evaluate('(e) => e.scrollTop < e.scrollHeight - e.clientHeight'), 'jump to current floor'
            page.goto(URL)
            page.get_by_test_id('dark-cave-challenge').click()
            assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start" && c.control==="manual").length') == 1
            page.get_by_test_id('dark-cave-battle-background').wait_for()
            page.get_by_test_id('dark-cave-combat-panels').wait_for()
            # Simulate a later equipment edit and a screen remount while the
            # server still owns the original active fight snapshot.
            page.evaluate("window.__profileChanged = true; localStorage.removeItem('territory_adventure_session_v1:review')")
            page.locator('#remount').evaluate('(e) => e.click()')
            page.get_by_test_id('dark-cave-battle-background').wait_for()
            assert page.get_by_test_id('dark-cave-toggle-auto').get_attribute('aria-pressed') == 'false'
            page.get_by_role('button',name='Продолжить бой').wait_for(state='visible')
            assert page.get_by_role('button',name='Продолжить бой').is_enabled(), 'pinned fight must remain playable after restore'
            page.get_by_role('button',name='Экипировка').click()
            page.get_by_role('button',name='Пояс эликсиров').click()
            page.get_by_text('Только просмотр: эффекты эликсиров').wait_for()
            assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start").length') == 1
            page.get_by_role('button',name='Продолжить бой').click()
            page.get_by_text('Победа!').wait_for()
            assert page.get_by_test_id('dark-cave-battle-log').locator('p').count() == 2, 'both server-confirmed hit and block must remain in combat log'
            assert page.get_by_text('+10 монет').count() == 1
            page.get_by_test_id('dark-cave-next-floor').wait_for()
            assert '2' in page.get_by_test_id('dark-cave-next-floor').inner_text(), 'new floor must come from server progress'
            assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="advance").length') == 1
            page.get_by_role('button',name='К этапам').click()
            page.get_by_text('Этаж 2 / 100').wait_for()
            assert page.get_by_test_id('dark-cave-challenge').is_disabled(), 'unreviewed equipment must not enable another start'
            assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start").length') == 1
        page.close()
    for width, height in [(320,568),(360,700),(390,844),(430,740)]:
        page = browser.new_page(viewport={'width':width,'height':height})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.route(URL+'**',serve)
        page.goto(URL+'?lang=en')
        page.get_by_test_id('dark-cave-challenge').wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'English horizontal overflow'
        page.get_by_test_id('dark-cave-challenge').click()
        assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start" && c.control==="manual").length') == 1
        page.get_by_test_id('dark-cave-battle-background').wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'English combat horizontal overflow'
        page.get_by_role('button',name='Continue battle').click()
        page.get_by_text('Victory!').wait_for()
        assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="advance").length') == 1
        page.close()
    # Auto switch inside a server-manual battle: no second charge, same receipt path.
    for lang in ('ru','en'):
        page = browser.new_page(viewport={'width':390,'height':844})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.route(URL+'**',serve)
        page.goto(URL + ('?lang=en' if lang == 'en' else ''))
        page.get_by_test_id('dark-cave-challenge').wait_for()
        page.get_by_test_id('dark-cave-challenge').click()
        page.get_by_test_id('dark-cave-toggle-auto').click()
        assert page.get_by_test_id('dark-cave-toggle-auto').get_attribute('aria-pressed') == 'true'
        page.get_by_text('Victory!' if lang == 'en' else 'Победа!', exact=True).wait_for(timeout=10000)
        assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start").length') == 1
        assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="advance").length') == 1
        page.close()
    for lang, outcome, label in [('ru','enemy_won','Поражение'),('ru','draw','Ничья'),('en','enemy_won','Defeat'),('en','draw','Draw')]:
        page = browser.new_page(viewport={'width':360,'height':700})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.route(URL+'**',serve)
        page.goto(URL + ('?lang=en' if lang == 'en' else ''))
        page.get_by_test_id('dark-cave-challenge').wait_for()
        page.evaluate('(result) => { window.__nextOutcome = result }', outcome)
        page.get_by_test_id('dark-cave-challenge').click()
        assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start" && c.control==="manual").length') == 1
        page.get_by_test_id('dark-cave-battle-background').wait_for()
        page.get_by_role('button',name='Continue battle' if lang == 'en' else 'Продолжить бой').click()
        page.get_by_text(label, exact=True).wait_for()
        assert page.get_by_text('+10 монет').count() == 0
        assert page.get_by_text('+10 gold').count() == 0
        assert page.get_by_test_id('dark-cave-next-floor').count() == 0, 'defeat/draw must not claim an unlocked floor'
        page.get_by_role('button',name='Back to cave stages' if lang == 'en' else 'К этапам пещеры').click()
        page.get_by_text('Floor 1 / 100' if lang == 'en' else 'Этаж 1 / 100').wait_for()
        page.close()
    # Pending advance can be replayed and then resumed with the SAME confirmed
    # event IDs. One impact and one block must not become four visual log rows.
    for lang in ('ru', 'en'):
        page = browser.new_page(viewport={'width':390,'height':844})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route(URL+'**', serve)
        page.goto(URL + ('?pending=1&lang=en' if lang == 'en' else '?pending=1'))
        log = page.get_by_test_id('dark-cave-battle-log')
        log.wait_for()
        assert log.locator('p').count() == 2, 'Repeated server receipt must not duplicate confirmed hit/block'
        assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="advance").length') == 1
        assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="resume").length') == 1
        assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start").length') == 0
        page.close()
    assert not errors, errors
    browser.close()
print('Adventure browser PASS: 320/360/390/430 no overflow, one server start, one advance, confirmed reward, next stage (offline fixture).')
