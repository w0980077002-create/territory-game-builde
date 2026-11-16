"""Actual cave Canvas/controls: gate motion, pause, reduced motion and art fallback.
Uses only the offline --test build, never player credentials or account writes.
Optional CAVE_PORTAL_BASELINE captures the pre-#537 playable fixture as evidence.
"""
import base64, json, os, shutil, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/cave-expedition/portal-evidence'
OUT.mkdir(parents=True, exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT / 'artifacts/cave-expedition')))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}/test-fixture.html'

def ready(page, baseline=None):
    if baseline:
        page.route(URL, lambda route: route.fulfill(body=Path(baseline).read_bytes(), content_type='text/html'))
    page.goto(URL)
    page.get_by_role('button', name='В путь').wait_for()

def pixels(page):
    return page.evaluate('document.querySelector("canvas").toDataURL()')

def choice(page):
    page.get_by_role('button', name='В путь').tap()
    page.evaluate('__caveDemo.step(3)')
    page.locator('.cx-portals button').first.wait_for()
    page.wait_for_timeout(120)

reports = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium'), args=['--no-sandbox'])
    for width, height in [(320,568),(360,640),(390,844),(430,740)]:
        for label, baseline in [('after',None)] + ([('before',os.environ['CAVE_PORTAL_BASELINE'])] if os.getenv('CAVE_PORTAL_BASELINE') else []):
            page = browser.new_page(viewport={'width':width,'height':height}, is_mobile=True, has_touch=True)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            ready(page, baseline)
            page.screenshot(path=str(OUT / f'{label}-{width}-lobby.png'))
            choice(page)
            assert page.locator('.cx-portals button').count() == 3
            for box in page.locator('.cx-portals button').all():
                b = box.bounding_box()
                assert b['x'] >= 0 and b['x'] + b['width'] <= width + 1
            assert page.get_by_test_id('cx-umbra-slot').count() == 12
            assert page.get_by_test_id('cx-wings-slot').count() == 1
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1')
            page.screenshot(path=str(OUT / f'{label}-{width}-choice.png'))
            page.get_by_role('button', name='Пауза', exact=True).tap()
            page.wait_for_timeout(100)
            frozen = pixels(page)
            page.wait_for_timeout(200)
            assert pixels(page) == frozen, 'Paused gates must freeze exactly'
            page.get_by_role('button', name='Продолжить путь').tap()
            page.locator('.cx-portals button').nth(2).tap()
            page.wait_for_timeout(230)
            page.screenshot(path=str(OUT / f'{label}-{width}-entry.png'))
            page.wait_for_function("()=>__caveDemo.world.phase==='FIGHT'", timeout=20000)
            assert page.evaluate('__caveDemo.world.stars[0]') == 3
            assert not errors, errors
            page.close()
        print(f'PASS {width}x{height}: three risks, pause, entry', flush=True)
        reports.append({'width':width,'height':height,'three_touch_targets':True,'slots':13,'pause_pixels':'exact','entry_to_fight':'PASS'})
    # Lobby has no simulation clock: the cosmetic clock must still rotate, freeze
    # on pause, and become entirely static when reduced motion is requested.
    page = browser.new_page(viewport={'width':360,'height':640}, is_mobile=True, has_touch=True)
    ready(page); page.wait_for_timeout(100)
    normal = pixels(page); page.wait_for_timeout(180)
    assert pixels(page) != normal, 'Idle portal should be alive'
    page.evaluate('__caveDemo.world.paused=true'); page.wait_for_timeout(100)
    frozen = pixels(page); page.wait_for_timeout(200)
    assert pixels(page) == frozen
    page.evaluate('__caveDemo.world.paused=false')
    page.emulate_media(reduced_motion='reduce'); page.wait_for_timeout(100)
    reduced = pixels(page); page.wait_for_timeout(200)
    assert pixels(page) == reduced, 'Reduced-motion idle gate must be static'
    page.close()
    # Exercise every existing biome with the same renderer, without creating runs.
    page = browser.new_page(viewport={'width':360,'height':640}, is_mobile=True, has_touch=True)
    ready(page)
    for biome in ['crystal','spore','forge','astral','ember']:
        page.evaluate('(b)=>{__caveDemo.world.biome=b}', biome)
        page.wait_for_timeout(100)
        page.screenshot(path=str(OUT / f'biome-{biome}.png'))
    page.close()
    # A decorative atlas download failure must leave all three gates playable.
    bad = 'data:image/webp;base64,' + base64.b64encode((ROOT/'public/assets/territory/cave-expedition/portal-arches.webp').read_bytes()).decode()
    page = browser.new_page(viewport={'width':320,'height':568}, is_mobile=True, has_touch=True, reduced_motion='reduce')
    page.add_init_script("""const NativeImage=window.Image,source=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
      window.Image=function(...args){const img=new NativeImage(...args);Object.defineProperty(img,'src',{
      set(value){if(value==="""+json.dumps(bad)+"""){setTimeout(()=>img.onerror?.(new Event('error')),0)}else source.set.call(img,value)},get(){return source.get.call(img)}});return img};""")
    ready(page); choice(page)
    page.screenshot(path=str(OUT / 'atlas-fallback-320.png'))
    page.locator('.cx-portals button').first.tap()
    page.wait_for_function("()=>__caveDemo.world.phase==='FIGHT'", timeout=20000)
    assert page.evaluate('__caveDemo.world.stars[0]') == 1
    page.close(); browser.close()
server.shutdown()
reports.append({'lobby_motion':'PASS','lobby_pause':'exact','reduced_motion':'static','biomes':5,'atlas_failure':'playable'})
(OUT/'report.json').write_text(json.dumps(reports,indent=2))
print('PASS gates: 4 widths, three risks, 13 slots, exact pause, static reduced motion, 5 biomes, atlas fallback')
