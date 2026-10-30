"""Test the production map and locations drawer with an offline route callback."""
import os, threading, shutil
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
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    for width in (320,360,390,430):
        for language in ('ru','en'):
            page = browser.new_page(viewport={'width': width, 'height': 500}, reduced_motion='reduce')
            page.add_init_script(f"localStorage.setItem('territory-language','{language}')")
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-map-preview.html')
            trigger=page.get_by_role('button', name='All locations' if language=='en' else 'Все места')
            trigger.click()
            dialog=page.get_by_role('dialog')
            close=dialog.get_by_role('button', name='Close' if language=='en' else 'Закрыть')
            rect=close.bounding_box()
            assert rect['width'] >= 44 and rect['height'] >= 44
            head=dialog.locator('.territory-world-map__drawer-head').bounding_box()
            title=dialog.locator('.territory-wooden-plaque').bounding_box()
            assert abs((head['x']+head['width']/2)-(title['x']+title['width']/2)) < 1
            assert close.evaluate('(el) => document.activeElement === el')
            assert dialog.locator('.territory-world-map__drawer-scroll').evaluate('(el) => el.scrollHeight > el.clientHeight')
            page.keyboard.press('Escape')
            assert dialog.count() == 0 and trigger.evaluate('(el) => document.activeElement === el')
            trigger.click()
            dialog.get_by_role('button', name='Forge' if language=='en' else 'Кузница').click()
            assert page.evaluate('window.__route') == 'forge'
            assert dialog.count() == 0 and page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.close()
    browser.close()
server.shutdown()
print('Map drawer browser checks passed: 320/360/390/430, RU/EN, short height, scroll, Escape, focus and route.')
