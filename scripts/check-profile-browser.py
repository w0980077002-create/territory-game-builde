"""Smoke the actual profile component with an offline in-memory player."""
import os, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        public_file = os.path.join(os.getcwd(), 'public', path.lstrip('/'))
        if os.path.isfile(public_file):
            return public_file
        return super().translate_path(path)
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for lang in ('ru', 'en'):
            page=browser.new_page(viewport={'width':width, 'height':500})
            page.add_init_script(f"localStorage.setItem('territory-language', '{lang}')")
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html')
            page.locator('.territory-profile-stat').first.wait_for()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('.territory-profile-stat').count() >= 4
            page.locator('[data-testid="profile-appearance"] summary').click()
            assert page.locator('[data-testid="profile-appearance"] button').count() >= 4
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            if width == 360 and lang == 'ru':
                page.locator('.territory-shell').evaluate('(el) => el.scrollTop = 0')
                page.screenshot(path='/tmp/territory-profile-360.png')
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?inventory')
            tile = page.locator('.warehouse-tile').first
            tile.click()
            dialog = page.get_by_role('dialog')
            assert dialog.count() == 1
            assert dialog.locator('.inventory-item-detail').count() == 1
            close = dialog.locator('.territory-modal-close')
            rect = close.bounding_box()
            assert rect and rect['width'] >= 44 and rect['height'] >= 44
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            if width == 360 and lang == 'ru': page.screenshot(path='/tmp/territory-item-360.png')
            close.click()
            assert dialog.count() == 0
            assert tile.evaluate('(el) => document.activeElement === el')
            forge = page.locator('.warehouse-tile--forge')
            forge.click()
            assert dialog.locator('.warehouse-info-content').count() == 1
            page.keyboard.press('Escape')
            assert dialog.count() == 0
            assert forge.evaluate('(el) => document.activeElement === el')
            page.close()
    browser.close()
server.shutdown()
print('Profile and inventory browser checks passed: 320/360/390/430, RU/EN, short height, appearance expansion and item dialog.')
