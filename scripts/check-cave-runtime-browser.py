"""Real UI -> real receipt adapter -> local service/engine/SQL; fake identity only.

Start node scripts/serve-cave-runtime-preview.mjs first. Never contacts Supabase.
"""
import json
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.getenv('CAVE_RUNTIME_URL', 'http://127.0.0.1:4178')
OUT = Path('docs/evidence/cave-stage-a')
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, has_touch=True)
    errors, external, missing_art = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda req: external.append(req.url) if not req.url.startswith(URL) else None)
    page.on('response', lambda response: missing_art.append(response.url) if response.status == 404 and response.url.endswith(('.webp', '.svg', '.png')) else None)
    page.goto(URL)
    assert page.get_by_test_id('dark-cave-new-expedition').count() == 0, 'one unified candidate menu'
    page.get_by_test_id('dark-cave-challenge').wait_for()
    # Campaign -> Trials -> Cave and the actual MapScreen entrance agree.
    page.get_by_role('tab', name='Поход', exact=True).click()
    page.get_by_role('tab', name='Испытания', exact=True).click()
    page.get_by_role('tab', name='Тёмная пещера', exact=True).click()
    page.get_by_test_id('dark-cave-challenge').wait_for()
    assert '5' in page.get_by_test_id('dark-stone-balance').inner_text()
    page.get_by_role('navigation').get_by_role('button', name='Карта', exact=True).click()
    page.get_by_test_id('map-server-adventure-entry').click()
    page.get_by_test_id('dark-cave-challenge').click()
    page.get_by_test_id('dark-cave-playback').wait_for()
    page.wait_for_function("document.querySelector('canvas').width>=430")
    first_frame = page.locator('canvas').evaluate('(el)=>el.toDataURL()')
    page.wait_for_timeout(1600)
    assert first_frame != page.locator('canvas').evaluate('(el)=>el.toDataURL()'), 'live scene must move without a network step'
    assert page.locator('.cv-live-gear button').count() == 7
    page.screenshot(path=str(OUT / 'after-battle-390.png'))

    def inspect():
        return page.evaluate("async()=> (await (await fetch('/api/inspect',{method:'POST',body:'{}'})).json()).data")

    first = inspect()
    session_id = first['sessions'][0]['session_id']
    assert first['stones'][0]['balance'] == 4
    assert page.get_by_role('navigation').get_by_role('button').count() == 7
    page.get_by_test_id('dark-cave-toggle-auto').click()
    page.wait_for_timeout(2600)
    page.get_by_test_id('dark-cave-pause').click()
    page.wait_for_function("document.querySelector('[data-testid=dark-cave-pause]').getAttribute('aria-pressed')==='true'")
    paused = inspect()
    at_ms = paused['sessions'][0]['state']['atMs']
    assert at_ms > 0
    page.wait_for_timeout(200)
    paused_frame = page.locator('canvas').evaluate('(el)=>el.toDataURL()')
    page.wait_for_timeout(1800)
    assert paused_frame == page.locator('canvas').evaluate('(el)=>el.toDataURL()'), 'pause freezes the presentation as well as the server clock'
    assert inspect()['sessions'][0]['state']['atMs'] == at_ms
    page.reload()
    page.get_by_test_id('dark-cave-pause').wait_for()
    assert page.get_by_test_id('dark-cave-pause').get_attribute('aria-pressed') == 'true'
    assert inspect()['sessions'][0]['session_id'] == session_id
    assert inspect()['stones'][0]['balance'] == 4
    page.get_by_test_id('dark-cave-pause').click()
    page.wait_for_function("document.querySelector('[data-testid=dark-cave-pause]').getAttribute('aria-pressed')==='false'")
    page.get_by_test_id('dark-cave-speed').click()
    page.wait_for_function("document.querySelector('[data-testid=dark-cave-speed]').getAttribute('aria-pressed')==='true'")
    assert inspect()['sessions'][0]['state']['caveRuntime']['speed'] == 2
    # One real belt dose, including the real cloud token update.
    page.get_by_role('button', name='Настой жизни', exact=True).click()
    page.get_by_test_id('dark-cave-drink').click()
    page.wait_for_function("!document.querySelector('[data-testid=dark-cave-toggle-auto]').disabled")
    after_drink = inspect()
    assert after_drink['player']['game_state']['belt'][0]['qty'] == 4
    assert after_drink['player']['game_state']['battleStones'] == 37
    assert after_drink['sessions'][0]['state']['caveRuntime']['belt'][0]['used'] == 1
    # Lose a response after a committed advance. Recovery reuses its UUID.
    page.evaluate('window.__dropNextAdvance=true')
    page.get_by_role('button', name='Продолжить бой', exact=True).click()
    page.get_by_role('button', name='Восстановить бой', exact=True).wait_for()
    revision = inspect()['sessions'][0]['revision']
    page.reload()
    page.get_by_test_id('dark-cave-playback').wait_for()
    assert inspect()['sessions'][0]['revision'] == revision
    assert inspect()['stones'][0]['balance'] == 4
    assert page.get_by_test_id('dark-cave-auto-potions').get_attribute('aria-pressed') == 'false'
    # Leave through the seven-button nav and return: same server fight.
    page.get_by_role('navigation').get_by_role('button', name='Инвентарь', exact=True).click()
    page.get_by_role('navigation').get_by_role('button', name='Бой', exact=True).click()
    page.get_by_test_id('dark-cave-playback').wait_for()
    assert inspect()['sessions'][0]['session_id'] == session_id
    assert inspect()['player']['game_state']['belt'][0]['qty'] == 4
    page.get_by_role('tab', name='Испытания', exact=True).click()
    page.get_by_role('tab', name='Тёмная пещера', exact=True).click()
    page.get_by_test_id('dark-cave-playback').wait_for()
    assert inspect()['sessions'][0]['session_id'] == session_id
    page.get_by_role('navigation').get_by_role('button', name='Карта', exact=True).click()
    page.get_by_test_id('map-server-adventure-entry').click()
    page.get_by_test_id('dark-cave-playback').wait_for()
    assert len(inspect()['sessions']) == 1
    assert inspect()['stones'][0]['balance'] == 4
    # Actual scene, controls and seven navigation buttons fit every target size.
    geometry = []
    for lang in ('ru', 'en'):
        page.evaluate('(lang)=>localStorage.setItem("territory-language",lang)', lang)
        page.reload()
        page.get_by_test_id('dark-cave-playback').wait_for()
        for width, height in ((320, 568), (360, 640), (390, 844), (430, 740)):
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_timeout(500)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), (lang, width)
            nav = page.get_by_role('navigation').bounding_box()
            assert nav['y'] + nav['height'] <= height + 1
            pause = page.get_by_test_id('dark-cave-pause').bounding_box()
            assert pause['y'] + pause['height'] < nav['y'], (lang, width, pause, nav)
            assert pause['height'] >= 44
            belt = page.get_by_role('button', name='Настой жизни', exact=True).bounding_box()
            assert belt['y'] + belt['height'] < nav['y'], ('belt hidden', lang, width, belt, nav)
            panels = page.get_by_test_id('dark-cave-combat-panels').bounding_box()
            assert belt['y'] + belt['height'] <= panels['y'] + panels['height'] + 1, ('belt clipped', lang, width, belt, panels)
            assert page.locator('canvas').evaluate('(el)=>el.width>0 && el.height>0')
            assert page.locator('.cv-live-gear button').count() == 7
            geometry.append({'lang': lang, 'width': width, 'height': height, 'pause': pause, 'nav': nav})
            page.screenshot(path=str(OUT / f'after-{lang}-{width}.png'))
    # Return RU, finish through real Auto/engine/SQL and restore its reward.
    page.evaluate('localStorage.setItem("territory-language","ru")')
    page.evaluate("async()=>await fetch('/api/fixture-health',{method:'POST',body:'{}'})")
    page.reload()
    page.get_by_test_id('dark-cave-auto-potions').click()
    page.wait_for_function("document.querySelector('button[aria-label=\"Настой жизни\"]')?.textContent.trim()==='3'")
    assert page.get_by_test_id('dark-cave-toggle-auto').get_attribute('aria-pressed') == 'false', 'auto-potions work independently of Auto combat'
    assert inspect()['player']['game_state']['belt'][0]['qty'] == 3
    page.get_by_test_id('dark-cave-auto-potions').click()
    page.get_by_test_id('dark-cave-toggle-auto').click()
    page.get_by_role('button', name='К этажам пещеры', exact=True).wait_for(timeout=45000)
    won = inspect()
    assert len(won['settlements']) == 1
    assert won['settlements'][0]['receipt']['outcome'] == 'hero_won'
    assert won['player']['gold'] == 65
    page.screenshot(path=str(OUT / 'after-victory-430.png'))
    page.reload()
    page.get_by_role('button', name='К этажам пещеры', exact=True).wait_for()
    assert inspect()['player']['gold'] == 65
    assert len(inspect()['settlements']) == 1
    assert not errors, errors
    assert not external, external
    assert not missing_art, missing_art
    (OUT / 'browser-report.json').write_text(json.dumps({'geometry': geometry, 'sessionId': session_id, 'gold': 65,
        'darkStones': 4, 'battleStones': 37, 'dosesSpent': 2, 'settlements': 1, 'pageErrors': errors,
        'autoPotionSetup': 'synthetic 349 HP on the local session; actual dose action, cloud receipt and SQL debit',
        'entryRoutes': ['Campaign -> Cave', 'Trials -> Cave', 'actual MapScreen -> Cave', 'native nav return', 'reload'],
        'externalRequests': external, 'backend': 'ephemeral PGlite / actual service, engine, SQL, receipt adapter and CAS cloud code',
        'missingArt': missing_art,
        'physicalAndroid': 'unverified', 'telegramWebView': 'unverified'}, ensure_ascii=False, indent=2))
    browser.close()
print('Cave browser PASS: real engine/SQL, pause + reload, x2, dose debit, lost-response replay, navigation/resume, 320/360/390/430 RU/EN, one victory reward.')
