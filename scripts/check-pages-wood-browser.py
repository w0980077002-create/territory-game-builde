"""Check the built Pages CSS resolves and loads the approved plaque under its real base path."""
import http.server
import pathlib
import shutil
import threading
from playwright.sync_api import sync_playwright

root = pathlib.Path.cwd()
class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        return str(root / 'dist' / path.removeprefix('/territory-game-builde/').split('?')[0])
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
css = next((root / 'dist' / 'assets').glob('index-*.css')).name
base = f'http://127.0.0.1:{server.server_port}/territory-game-builde/'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    page = browser.new_page()
    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
    page.goto(base + 'index.html')
    response = page.request.get(base + 'assets/' + css)
    assert response.ok
    assert '/territory-game-builde/assets/territory/ui/wooden-plaque.webp' in response.text()
    with page.expect_response(lambda r: r.url == base + 'assets/territory/ui/wooden-plaque.webp') as image_response:
        background = page.evaluate('''() => {
          const el = document.createElement('div'); el.className = 'territory-modal-head';
          document.body.appendChild(el); return getComputedStyle(el).backgroundImage;
        }''')
    assert '/territory-game-builde/assets/territory/ui/wooden-plaque.webp' in background
    assert image_response.value.ok
    result = page.evaluate('''async (url) => { const i = new Image(); i.src = url; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }''', image_response.value.url)
    assert result[0] > 0 and result[1] > 0
    browser.close()
server.shutdown()
print('Built Pages CSS and plaque image loaded successfully under /territory-game-builde/.')
