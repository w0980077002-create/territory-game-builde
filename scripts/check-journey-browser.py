"""Offline campaign/trial UI: actual React screen, simulated combat and transport."""
import os, threading, shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        asset=os.path.join(os.getcwd(),'public',path.lstrip('/').split('?')[0])
        return asset if os.path.isfile(asset) else super().translate_path(path)
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory='/tmp'))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
    for width in (320,360,390,430):
        for lang in ('ru','en'):
            page=browser.new_page(viewport={'width':width,'height':500},reduced_motion='reduce')
            page.add_init_script(f"localStorage.setItem('territory-language','{lang}')")
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-journey-after.html')
            encounter=page.locator('.journey-encounter')
            page.wait_for_timeout(500)
            assert not errors,errors
            encounter.wait_for()
            assert encounter.locator('.journey-encounter__art img').evaluate('(el)=>el.complete && el.naturalWidth>0')
            fight=encounter.get_by_role('button',name='Fight' if lang=='en' else 'Бой')
            assert fight.bounding_box()['height'] >= 43.99
            heading=encounter.locator('h3')
            heading.evaluate("el => el.textContent = 'Очень длинное имя великого повелителя северных земель / Extremely long northern overlord name'")
            assert heading.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 3'), heading.evaluate('(el) => [el.scrollWidth,el.clientWidth,el.scrollHeight,el.clientHeight]')
            assert heading.bounding_box()['y'] + heading.bounding_box()['height'] <= encounter.locator('.journey-encounter__stats').bounding_box()['y'] + 1
            assert fight.is_visible() and fight.bounding_box()['x'] + fight.bounding_box()['width'] <= width
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            fight.click()
            assert page.get_by_test_id('fixture-fight').inner_text() == 'stage'
            page.get_by_test_id('fixture-fight').click()
            page.get_by_role('tab',name='Trials' if lang=='en' else 'Испытания').click()
            page.get_by_role('button',name='Start trial' if lang=='en' else 'Начать испытание').click()
            assert page.get_by_test_id('fixture-fight').inner_text() == 'trial'
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-journey-after.html?boss')
            assert page.locator('.journey-encounter__eyebrow').inner_text()
            assert page.locator('.journey-encounter').count() == 1
            page.evaluate("localStorage.setItem('territory_adventure_start_v1:fixture','pending')")
            page.reload()
            assert page.locator('.journey-encounter button').is_disabled()
            assert page.get_by_test_id('pending-cave-recovery').is_visible()
            page.get_by_role('button', name='Recover Dark Cave battle' if lang=='en' else 'Восстановить бой в пещере').click()
            assert page.get_by_test_id('fixture-cave').is_visible()
            page.close()
    browser.close()
server.shutdown()
print('Campaign/trial browser checks passed: actual BattleScreen, synthetic transport, 320/360/390/430, RU/EN.')
