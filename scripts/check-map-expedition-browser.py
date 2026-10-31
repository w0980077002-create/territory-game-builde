"""Map expedition: real React MapScreen, mocked transport, RU/EN and narrow viewports."""
import os
import shutil
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        asset = os.path.join(os.getcwd(), 'public', path.lstrip('/').split('?')[0])
        return asset if os.path.isfile(asset) else super().translate_path(path)
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for language in ('ru', 'en'):
            page = browser.new_page(viewport={'width': width, 'height': 568}, reduced_motion='reduce')
            page.add_init_script(f"localStorage.setItem('territory-language','{language}')")
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            url = f'http://127.0.0.1:{server.server_port}/territory-map-expedition-preview.html'
            page.goto(url + '?mode=active')
            banner = page.get_by_test_id('map-expedition-status')
            banner.wait_for()
            assert banner.is_visible()
            assert banner.bounding_box()['width'] <= width - 70
            banner.click()
            details = page.get_by_test_id('map-resource-details')
            details.wait_for()
            assert details.locator('.map-expedition-current').is_visible()
            assert not details.get_by_test_id('map-expedition-reward').count()
            page.get_by_role('dialog').get_by_role('button', name='Close' if language == 'en' else 'Закрыть').click()

            page.goto(url + '?mode=ready')
            banner = page.get_by_test_id('map-expedition-status')
            banner.wait_for()
            assert 'READY' in banner.inner_text() or 'ГОТОВА' in banner.inner_text()
            banner.click()
            details = page.get_by_test_id('map-resource-details')
            resource = details.get_by_role('button').filter(has_text='Iron' if language == 'en' else 'Железная')
            resource.first.click()
            reward = page.get_by_test_id('map-expedition-reward')
            reward.wait_for()
            assert reward.is_visible()
            assert page.evaluate("window.__mapCalls.filter(name => name === 'territory_gather_claim').length") == 1
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            reward.get_by_role('button', name='Forge' if language == 'en' else 'Кузница').click()
            assert page.evaluate('window.__mapRoute') == 'forge'
            assert not errors, errors

            page.goto(url + '?mode=error')
            retry = page.get_by_role('alert').get_by_role('button', name='Retry' if language == 'en' else 'Повторить')
            retry.wait_for()
            assert retry.bounding_box()['height'] >= 43.99
            retry.click()
            assert page.get_by_role('alert').count() == 0
            assert page.evaluate("window.__mapCalls.filter(name => name === 'territory_gather_start').length") == 0
            page.close()
    browser.close()
server.shutdown()
print('Map expedition browser PASS: active, ready, server claim, Forge route, retry, 320/360/390/430 RU/EN (mocked transport).')
