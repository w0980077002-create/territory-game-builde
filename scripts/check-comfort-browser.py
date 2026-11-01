"""Actual SettingsSheet in a short Telegram-like viewport, without live player data."""
import os
import shutil
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

class FixtureHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/assets/') or path.startswith('/ic-'):
            return os.path.join(os.getcwd(), 'public', path.lstrip('/'))
        return super().translate_path(path)

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(FixtureHandler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/territory-comfort-preview.html'
Path('/tmp/comfort-screenshots').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for language in ('ru', 'en'):
            for ios in (False, True):
                page = browser.new_page(viewport={'width': width, 'height': 500})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                init = f"localStorage.setItem('territory-language', '{language}');"
                if ios:
                    init += "document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('territory-ios-webapp'));"
                page.add_init_script(init)
                page.goto(url)
                panel = page.locator('.territory-modal-panel')
                panel.wait_for()
                rect = panel.bounding_box()
                assert rect and rect['x'] >= -1 and rect['x'] + rect['width'] <= width + 1, (width, language, ios, rect)
                assert rect['y'] >= -1 and rect['y'] + rect['height'] <= 501, (width, language, ios, rect)
                assert page.locator('.territory-settings-heading').count() == 2
                assert page.locator('.territory-settings-toggle').count() == 4
                assert page.locator('.territory-settings-heading').first.inner_text() == ('Combat controls' if language == 'en' else 'Управление боем')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, language, ios, 'horizontal overflow')
                switches = page.locator('.territory-settings-toggle')
                assert switches.nth(0).get_attribute('aria-checked') == 'false'
                switches.nth(0).click()
                assert switches.nth(0).get_attribute('aria-checked') == 'true'
                assert switches.nth(2).get_attribute('aria-checked') == 'true'
                switches.nth(2).click()
                assert switches.nth(2).get_attribute('aria-checked') == 'false'
                assert page.evaluate("localStorage.getItem('territory_haptic_feedback')") == 'off'
                switches.nth(3).click()
                assert switches.nth(3).get_attribute('aria-checked') == 'false'
                backgrounds = page.locator('.territory-settings button[aria-pressed]')
                assert backgrounds.count() == 3, 'Winter Peaks and both previous scenery choices remain available'
                assert ('Winter peaks' if language == 'en' else 'Ледяные вершины') in backgrounds.nth(0).inner_text()
                backgrounds.nth(0).click()
                assert backgrounds.nth(0).get_attribute('aria-pressed') == 'true'
                portrait = backgrounds.nth(0).locator('img')
                portrait.evaluate("(img) => img.decode()")
                dimensions = portrait.evaluate("(img) => [img.naturalWidth, img.naturalHeight]")
                assert dimensions[0] >= 640 and 1.6 < dimensions[1] / dimensions[0] < 1.9, (width, language, ios, dimensions)
                backgrounds.nth(2).click()
                assert backgrounds.nth(2).get_attribute('aria-pressed') == 'true'
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, language, ios, 'scenery overflow')
                assert page.locator('.territory-modal-close').is_visible()
                if width == 360 and language == 'ru' and ios:
                    page.screenshot(path='/tmp/comfort-screenshots/settings-360-ru-ios.png')
                page.locator('.territory-modal-close').click()
                assert panel.count() == 0
                page.locator('#settings').click()
                assert page.locator('.territory-settings-toggle').nth(2).get_attribute('aria-checked') == 'false'
                assert page.locator('.territory-settings-toggle').nth(0).get_attribute('aria-checked') == 'true'
                assert not errors, (width, language, ios, errors)
                page.close()
    browser.close()
server.shutdown()
print('Settings browser PASS: real component, 320/360/390/430, RU/EN, Android/iOS-like 500px, save/restore and close.')
