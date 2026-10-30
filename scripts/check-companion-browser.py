"""Offline tests of the actual companion panel; no server or player accounts."""
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
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for language in ('ru', 'en'):
            page = browser.new_page(viewport={'width': width, 'height': 500}, reduced_motion='reduce')
            page.add_init_script(f"localStorage.setItem('territory-language', '{language}')")
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-companion-after.html?active')
            panel = page.locator('[data-testid="followers-panel"]')
            panel.wait_for()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert panel.locator('.followers-camp__portrait').count() == 6
            assert panel.locator('.followers-camp__portrait[aria-pressed="true"]').count() == 1
            assert panel.locator('.followers-camp__detail-top img').evaluate('(el) => el.complete && el.naturalWidth > 0')
            panel.locator('.followers-camp__portrait').nth(1).click()
            assert panel.locator('.followers-camp__portrait[aria-pressed="true"]').count() == 1
            assert ('Northern Warrior' if language == 'en' else 'Северный воин') in panel.locator('.followers-camp__detail h3').inner_text()
            assert ('VIEWING COMPANION' if language == 'en' else 'ПРОСМОТР СПУТНИКА') in panel.locator('.followers-camp__detail').inner_text()
            choose = panel.locator('.followers-camp__choose')
            assert choose.is_enabled()
            choose.click()
            assert choose.is_disabled()
            assert ('ACTIVE COMPANION' if language == 'en' else 'АКТИВНЫЙ СПУТНИК') in panel.locator('.followers-camp__detail').inner_text()
            panel.locator('.followers-camp__portrait').last.click()
            assert ('Battle Cow' if language == 'en' else 'Боевая корова') in panel.locator('.followers-camp__detail h3').inner_text()
            assert panel.locator('.followers-camp__availability--locked').is_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.close()
    browser.close()
server.shutdown()
print('Companion browser checks passed: real component, locked and active state, selection, 320/360/390/430, RU/EN.')
