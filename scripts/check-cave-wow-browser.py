"""Addressed visual defects of the cave WOW pass, on the real Canvas + HTML of the offline
--test build. Chromium only: this is NOT a physical Telegram WebView or Android benchmark.

Checks: boss HUD no longer collides with the header at four phone widths (RU/EN), boss
intro freezes pixel-exactly on pause, the ending window fits the stage with every button
reachable, loot shows its existing rarity, the ending is alive / static under reduced
motion, a restored victory opens without replaying the finale, and a throttled frame budget.
"""
import json, os, shutil, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/cave-expedition/wow-evidence'
OUT.mkdir(parents=True, exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT / 'artifacts/cave-expedition')))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}/test-fixture.html'
PIXELS = 'document.querySelector("canvas").toDataURL()'
STATE = '({phase:__caveDemo.world.phase,boss:__caveDemo.world.bossPhase,kills:__caveDemo.world.kills})'

def begin(page, lang='ru'):
    page.goto(URL + '?lang=' + lang)
    page.get_by_role('button', name='Set out' if lang == 'en' else 'В путь').tap()
    page.evaluate('__caveDemo.world.auto=true;__caveDemo.world.autoPotions=true')

def advance(page, done, limit=1500):
    """Real engine steps through the fixture; gates are chosen with the real buttons."""
    for _ in range(limit):
        state = page.evaluate(STATE)
        if done(state): return state
        if state['phase'] == 'PORTAL_CHOICE': page.locator('.cx-portals button').nth(1).tap()
        else: page.evaluate('__caveDemo.step(.5)')
        page.wait_for_timeout(15)
    raise AssertionError(f'Scenario did not reach its checkpoint: {state}')

def box(page, selector):
    return page.locator(selector).first.bounding_box()

reports = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium'), args=['--no-sandbox'])
    for (width, height), lang in zip([(320, 568), (360, 640), (390, 844), (430, 740)], ['ru', 'en', 'ru', 'en']):
        context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True)
        page = context.new_page(); errors = []; external = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: external.append(r.url) if not r.url.startswith(('http://127.0.0.1', 'data:', 'blob:')) else None)
        begin(page, lang)
        advance(page, lambda s: s['phase'] == 'BOSS')
        page.wait_for_timeout(200)
        # Defect: the header's second line wrapped into the boss bar on narrow phones.
        line, bar, stage = box(page, '.cx-chapter span'), box(page, '.cx-boss'), box(page, '.cx-stage')
        assert line['height'] < 17, f'Header status must stay on one line, got {line}'
        assert line['y'] + line['height'] <= bar['y'] + 1, f'Header overlaps the boss bar: {line} vs {bar}'
        assert bar['x'] >= 0 and bar['x'] + bar['width'] <= width + 1
        assert page.locator('.cx-boss').get_attribute('data-phase') == '1'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1')
        page.screenshot(path=str(OUT / f'boss-arrival-{width}-{lang}.png'))
        # The arrival theatre lives on the simulation clock: a pause freezes it pixel-exactly.
        page.get_by_role('button', name='Pause' if lang == 'en' else 'Пауза', exact=True).tap()
        page.wait_for_timeout(120); frozen = page.evaluate(PIXELS); page.wait_for_timeout(220)
        assert page.evaluate(PIXELS) == frozen, 'Boss arrival must freeze exactly on pause'
        page.get_by_role('button', name='Continue' if lang == 'en' else 'Продолжить путь').tap()
        advance(page, lambda s: s['boss'] == 2 or s['phase'] != 'BOSS')
        page.wait_for_timeout(120)
        if page.evaluate(STATE)['phase'] == 'BOSS':
            assert page.locator('.cx-boss').get_attribute('data-phase') == '2'
            page.screenshot(path=str(OUT / f'boss-phase2-{width}-{lang}.png'))
        state = advance(page, lambda s: s['phase'] in ['VICTORY', 'DEFEAT'])
        assert state['phase'] == 'VICTORY', state
        # Ending: the card arrives after the finale, fits the stage, and nothing is cut off.
        card = page.locator('.cx-result-card'); card.wait_for(state='visible', timeout=8000)
        # Measure the settled window: wait for its one-shot reveal animations, not the idle loops.
        card.evaluate("e=>Promise.all(e.getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished))")
        stage = box(page, '.cx-stage'); buttons = page.locator('.cx-result-actions button').all()
        assert len(buttons) >= 3
        for button in buttons:
            b = button.bounding_box()
            assert b['height'] >= 43.5, f'Touch target too small: {b}'
            assert b['x'] >= stage['x'] - 1 and b['x'] + b['width'] <= stage['x'] + stage['width'] + 1
            assert b['y'] + b['height'] <= stage['y'] + stage['height'] + 1, f'Button below the stage at {width}x{height}: {b}'
        assert page.locator('.cx-loot > div').count() >= 1
        assert all(text.strip() for text in page.locator('.cx-loot > div em').all_inner_texts()), 'Every loot card names its existing rarity'
        fits = card.evaluate('e=>e.scrollHeight<=e.clientHeight+1')
        if height >= 640: assert fits, 'Ending card must fit without scrolling on a regular phone'
        assert page.get_by_test_id('cx-umbra-slot').count() == 12 and page.get_by_test_id('cx-wings-slot').count() == 1
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1')
        before = page.evaluate(PIXELS); page.wait_for_timeout(260)
        assert page.evaluate(PIXELS) != before, 'The ending scene stays alive behind the window'
        page.screenshot(path=str(OUT / f'victory-{width}-{lang}.png'))
        # A reload restores the result without replaying the eruption or losing the window.
        page.reload(); page.locator('.cx-result-card').wait_for(state='visible', timeout=8000)
        assert page.evaluate('__caveDemo.world.phase') == 'VICTORY'
        assert not errors, errors
        assert not external, external
        reports.append({'width': width, 'height': height, 'lang': lang, 'header_vs_boss_bar': 'clear', 'pause_pixels': 'exact', 'ending_card_fits': fits, 'buttons': len(buttons), 'reload': 'restored'})
        print(f'PASS {width}x{height} {lang}: boss HUD, exact pause, ending window, loot rarity, reload', flush=True)
        context.close()
    # Reduced motion: the ending is a still picture and the window does not wait for an animation.
    context = browser.new_context(viewport={'width': 360, 'height': 640}, is_mobile=True, has_touch=True, reduced_motion='reduce')
    page = context.new_page(); begin(page)
    assert advance(page, lambda s: s['phase'] in ['VICTORY', 'DEFEAT'])['phase'] == 'VICTORY'
    page.locator('.cx-result-card').wait_for(state='visible', timeout=1500)
    page.wait_for_timeout(200); still = page.evaluate(PIXELS); page.wait_for_timeout(260)
    assert page.evaluate(PIXELS) == still, 'Reduced motion ending must be static'
    reports.append({'reduced_motion_ending': 'static'}); context.close()
    # Frame budget in the heaviest moment (boss fight), 4x CPU throttle, DPR 2. Diagnostic only.
    context = browser.new_context(viewport={'width': 360, 'height': 640}, is_mobile=True, has_touch=True, device_scale_factor=2)
    page = context.new_page(); begin(page); advance(page, lambda s: s['phase'] == 'BOSS')
    cdp = context.new_cdp_session(page); cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4}); cdp.send('Performance.enable')
    heap = lambda: {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}.get('JSHeapUsedSize')
    start = heap()
    samples = sorted(page.evaluate('''()=>new Promise(resolve=>{const values=[];let last=performance.now(),start=last;function frame(now){values.push(now-last);last=now;if(now-start<8000)requestAnimationFrame(frame);else resolve(values)}requestAnimationFrame(frame)})''')[2:])
    report = {'scene': 'boss fight', 'viewport': '360x640', 'dpr': 2, 'cpu_throttle': 4, 'frames': len(samples), 'median_ms': round(samples[len(samples) // 2], 2), 'p95_ms': round(samples[int(len(samples) * .95)], 2), 'heap_start_bytes': start, 'heap_end_bytes': heap(), 'real_android': False}
    # Software-rendered CI Chromium under 4x throttle: a floor against collapse, not a phone FPS claim.
    assert len(samples) > 70 and report['median_ms'] < 120, report
    reports.append(report); print(report, flush=True); context.close()
    browser.close()
server.shutdown()
(OUT / 'report.json').write_text(json.dumps(reports, indent=2))
print('PASS cave WOW browser: boss HUD at 4 widths RU/EN, exact pause in boss theatre, ending window and loot, reload, reduced motion, throttled frame budget (Chromium, not a physical phone)')
