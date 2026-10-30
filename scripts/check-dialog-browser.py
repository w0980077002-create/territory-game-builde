"""Exercise production dialogs in an offline, short Telegram-like shell."""
import shutil
import threading
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from playwright.sync_api import sync_playwright

class FixtureHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/assets/'):
            return os.path.join(os.getcwd(), 'public', path.lstrip('/'))
        return super().translate_path(path)

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(FixtureHandler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/territory-dialog-preview.html'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for language in ('ru', 'en'):
            for ios in (False, True):
                page = browser.new_page(viewport={'width': width, 'height': 500})
                page.add_init_script(f"localStorage.setItem('territory-language', '{language}');" + ("document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('territory-ios-webapp'));" if ios else ''))
                page.goto(url)
                for name, panel, close, scroll in [('rules', '.arena-rules-panel', '.arena-rules-head button', '.arena-rules-list'), ('prizes', '.arena-prizes-panel', '.arena-prizes-close', '.arena-prizes-body'), ('common', '.territory-modal-panel', '.territory-modal-close', '.territory-modal-content')]:
                    page.locator('#'+name).click()
                    if name == 'common':
                        page.locator('#nested').click()
                        assert page.get_by_role('dialog').count() == 2
                        page.keyboard.press('Escape')
                        assert page.get_by_role('dialog').count() == 1
                        assert page.evaluate('document.activeElement.id') == 'nested'
                    rect = page.locator(panel).bounding_box()
                    button = page.locator(close).bounding_box()
                    assert rect and button and rect['x'] >= 0 and rect['x'] + rect['width'] <= width + 1, (name, width, rect)
                    assert rect['y'] >= 0 and rect['y'] + rect['height'] <= (400 if ios else 500) + 1, (name, ios, rect)
                    assert button['width'] >= 44 and button['height'] >= 44, button
                    if name == 'common':
                        head = page.locator('.territory-modal-head').bounding_box()
                        title = page.locator('.territory-modal-head h2').bounding_box()
                        assert abs((head['x'] + head['width']/2) - (title['x'] + title['width']/2)) < 1
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    area=page.locator(scroll)
                    assert area.evaluate('(e) => e.scrollHeight > e.clientHeight')
                    area.evaluate('(e) => e.scrollTop = e.scrollHeight')
                    assert area.evaluate('(e) => e.scrollTop > 0')
                    assert page.locator(close).is_visible()
                    if width == 360 and language == 'ru' and ios:
                        page.screenshot(path=f'/tmp/territory-{name}-360-ios.png')
                    page.keyboard.press('Escape')
                    assert page.locator(panel).count() == 0
                    assert page.evaluate('document.activeElement.id') == name
                    page.locator('#'+name).click()
                    page.locator(close).click()
                    assert page.locator(panel).count() == 0
                page.close()
    browser.close()
server.shutdown()
print('Dialog browser checks passed: 320/360/390/430, RU/EN, Android-like and iOS shell, short height.')
