"""Offline checks on real InventoryScreen and CompactWarehouse, without accounts or server writes."""
import os, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        asset = os.path.join(os.getcwd(), 'public', path.lstrip('/').split('?')[0])
        return asset if os.path.isfile(asset) else super().translate_path(path)
    def log_message(self, *args): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for language in ('ru', 'en'):
            page = browser.new_page(viewport={'width': width, 'height': 550}, reduced_motion='reduce')
            page.add_init_script(f"localStorage.setItem('territory-language', '{language}')")
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?inventory-prep')
            panel = page.locator('[data-testid="inventory-battle-preparation"]')
            panel.wait_for()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, language, 'overflow')
            assert page.locator('[data-testid="inventory-belt-status"]').is_visible()
            assert panel.locator('button').count() == 2
            for button in panel.locator('button').all():
                assert button.evaluate('(el) => el.getBoundingClientRect().height >= 44')
            potion = page.locator('.warehouse-tile', has_text='Зелье подготовки')
            potion.click()
            page.get_by_role('button', name=('To belt' if language == 'en' else 'На пояс')).click()
            assert '3' in page.locator('[data-testid="inventory-belt-status"]').inner_text()
            assert panel.get_by_role('status').is_visible()
            page.locator('[data-testid="inventory-pinned-belt"] button').first.click()
            assert '0 /' in page.locator('[data-testid="inventory-belt-status"]').inner_text()
            page.locator('.warehouse-tile--forge').click()
            page.get_by_role('button', name=('Open forge' if language == 'en' else 'Открыть кузницу')).click()
            assert page.evaluate('window.__route') == 'forge'
            panel.get_by_role('button', name=('Arena lobby' if language == 'en' else 'На Арену')).click()
            assert page.evaluate('window.__route') == 'arena'
            panel.get_by_role('button', name=('Campaign' if language == 'en' else 'В Поход')).click()
            assert page.evaluate('window.__route') == 'campaign'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, language, 'overflow after actions')
            if width == 360 and language == 'ru': page.screenshot(path='/tmp/territory-inventory-preparation-360.png')
            page.close()
    browser.close()
server.shutdown()
print('Inventory preparation browser PASS: real components, belt move/return, forge, Arena/Campaign, 320/360/390/430 RU/EN.')
