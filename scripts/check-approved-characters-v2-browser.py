"""Art QA in the existing offline cave fixture; no auth, API or player saves."""
import base64
import json
import shutil
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/cave-expedition/characters-v2-evidence'
OUT.mkdir(parents=True, exist_ok=True)
CATALOG = json.loads((ROOT / 'src/game/cavePreviewWorld/approvedCharacters.json').read_text())

class QuietHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/territory-game-builde/'):
            self.path = '/dist/' + self.path.removeprefix('/territory-game-builde/')
        super().do_GET()

    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
report = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        for width, height, en in [(320, 568, False), (360, 640, False), (390, 808, False), (430, 720, False), (640, 360, True)]:
            context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True, reduced_motion='reduce',
                                          user_agent='Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')
            page = context.new_page()
            errors, external = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda req: external.append(req.url) if not req.url.startswith((url, 'data:')) else None)
            page.goto(url + '/artifacts/cave-expedition/test-fixture.html' + ('?lang=en' if en else ''))
            page.get_by_role('button', name='Art v2 · 21 still frames' if en else 'Арт v2 · 21 стоп-кадр').tap()
            page.locator('#cq-character').wait_for()
            before = page.evaluate('JSON.stringify(__caveDemo.world)')
            for i, c in enumerate(CATALOG):
                page.locator('#cq-character').select_option(str(i))
                page.wait_for_function('()=>[...document.querySelectorAll(".cq-actor img")].every(i=>i.complete&&i.naturalWidth>0)')
                assert page.locator('.cq-actor').count() == 4
                assert page.locator('.cq-selected').get_attribute('data-character') == c['id']
                assert page.locator('[role=alert]').count() == 0
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight+1')
                scene = page.locator('.cq-scene').bounding_box()
                last = None
                for actor in page.locator('.cq-actor').all():
                    box = actor.bounding_box()
                    assert box['y'] >= scene['y'] + 26, (c['id'], box, scene)
                    assert box['x'] >= scene['x'] and box['x'] + box['width'] <= scene['x'] + scene['width'] + 1
                    assert last is None or last['x'] + last['width'] <= box['x'] + 1, (c['id'], 'overlap')
                    last = box
                for control in page.locator('.cq-root button, .cq-root select').all():
                    box = control.bounding_box()
                    assert box['height'] >= 44
                    assert 0 <= box['y'] and box['y'] + box['height'] <= height + 1
                if width == 360 or i in (2, 14, 17, 20):
                    page.screenshot(path=str(OUT / f'{width}-{c["id"]}.png'))
            assert page.evaluate('JSON.stringify(__caveDemo.world)') == before, 'QA does not advance the fight'
            page.get_by_role('button', name='Transparency' if en else 'Прозрачность', exact=True).tap()
            assert page.locator('.cq-scene').evaluate('(e)=>e.classList.contains("cq-checker")')
            page.get_by_role('button', name='Next →' if en else 'Далее →', exact=True).tap()
            assert page.locator('#cq-character').input_value() == '0'
            page.get_by_role('button', name='← Previous' if en else '← Назад', exact=True).tap()
            assert page.locator('#cq-character').input_value() == '20'
            page.get_by_role('button', name='‹ Back to cave' if en else '‹ К пещере', exact=True).tap()
            page.get_by_role('button', name='Play DEMO' if en else 'Играть DEMO').tap()
            page.wait_for_timeout(750)
            assert page.evaluate('__caveDemo.world.time') > 0
            assert not errors, errors
            assert not external, external
            assert context.cookies() == []
            assert page.evaluate('localStorage.length + sessionStorage.length') == 0
            report.append({'width': width, 'height': height, 'language': 'en' if en else 'ru', 'characters': 21, 'errors': errors, 'external_requests': external, 'result': 'PASS'})
            context.close()
            print(f'PASS {width}x{height}: 21 stills, no overlaps, touch controls, transparent background, return to DEMO, no storage or external requests', flush=True)
        # Decode actual built public URLs at the repository's GitHub Pages prefix.
        context = browser.new_context(viewport={'width': 360, 'height': 640}, is_mobile=True, has_touch=True)
        page = context.new_page()
        paths = [f'assets/territory/cave-expedition/characters-v2/{c["category"]}/{c["id"]}/idle-still.webp' for c in CATALOG]
        page.goto(url + '/artifacts/cave-expedition/test-fixture.html')
        for path in paths:
            response = context.request.get(url + '/territory-game-builde/' + path)
            assert response.ok and response.body() == (ROOT / 'public' / path).read_bytes(), path
        # Deliberately break only a new sprite in a temporary fixture, never a game asset.
        fixture = (ROOT / 'artifacts/cave-expedition/test-fixture.html').read_text()
        encoded = base64.b64encode((ROOT / 'public' / paths[0]).read_bytes()).decode()
        assert encoded in fixture
        broken = ROOT / 'artifacts/cave-expedition/missing-art-fixture.html'
        broken.write_text(fixture.replace(encoded, 'broken'))
        page.goto(url + '/artifacts/cave-expedition/missing-art-fixture.html')
        page.get_by_role('button', name='Арт v2 · 21 стоп-кадр').tap()
        page.get_by_role('alert').wait_for()
        assert 'strongman_boulder' in page.get_by_role('alert').inner_text()
        page.get_by_role('button', name='Далее →', exact=True).tap()
        page.wait_for_function('()=>[...document.querySelectorAll(".cq-actor img")].every(i=>i.complete&&i.naturalWidth>0)')
        assert page.get_by_role('alert').count() == 0
        page.get_by_role('button', name='‹ К пещере', exact=True).tap()
        page.get_by_role('button', name='Играть DEMO').wait_for()
        context.close()
        report.append({'built_asset_urls': 21, 'base': '/territory-game-builde/', 'missing_sprite_fallback': 'PASS', 'result': 'PASS'})
        print('PASS 21 built GitHub Pages asset URLs; missing sprite has explicit fallback and scene remains navigable', flush=True)
        browser.close()
finally:
    server.shutdown()
(OUT / 'browser-report.json').write_text(json.dumps({'browser': 'Chromium, emulated Android UA/touch; not physical Android or Telegram WebView', 'viewports': report}, indent=2) + '\n')
