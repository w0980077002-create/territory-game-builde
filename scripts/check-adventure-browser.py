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
        assert actions.is_visible() and challenge.is_visible(), 'Challenge and blessings must be visible without scrolling main page'
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
        assert page.locator('button').count() >= 8
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow'
        page.screenshot(path=str(OUT / ('adventure-'+str(width)+'.png')), full_page=True)
        if width == 390:
            assert page.get_by_test_id('dark-cave-current-floor').count() == 1
            assert floor_panel.locator('[aria-label*="закрыт"]').count() >= 95, 'locked floors visible in scroll catalog'
            floor_panel.evaluate('(e) => {e.scrollTop = e.scrollHeight}')
            assert floor_panel.evaluate('(e) => e.scrollTop > 0'), 'must scroll beyond initial floors'
            page.get_by_role('button',name='Мой этаж').click()
            assert floor_panel.evaluate('(e) => e.scrollTop < e.scrollHeight - e.clientHeight'), 'jump to current floor'
            page.get_by_test_id('dark-cave-challenge').click()
            page.get_by_text('Серверный бой').wait_for()
            assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start").length') == 1
            page.get_by_role('button',name='Следующий шаг боя').click()
            page.get_by_text('Победа!').wait_for()
            assert page.get_by_text('+10 монет').count() == 1
            assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="advance").length') == 1
            page.get_by_role('button',name='К этапам').click()
            page.get_by_text('Этаж 2 / 100').wait_for()
            assert page.evaluate('window.__adventureCalls.filter(c=>c.action==="start").length') == 1
        page.close()
    assert not errors, errors
    browser.close()
print('Adventure browser PASS: 320/360/390/430 no overflow, one server start, one advance, confirmed reward, next stage (offline fixture).')
