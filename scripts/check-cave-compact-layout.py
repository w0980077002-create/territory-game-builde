"""Regression: compact cave must keep floors usable without hiding Challenge.

Uses the existing offline React fixture from build-adventure-preview.mjs.
Never connects to production Supabase or mutates player data.
"""
from pathlib import Path
from urllib.parse import urlparse
import os
import shutil
from playwright.sync_api import sync_playwright

FIXTURE = Path('/tmp/adventure-preview.html')
URL = 'http://127.0.0.1:4175/'


def serve(route):
    if urlparse(route.request.url).path == '/':
        route.fulfill(body=FIXTURE.read_bytes(), content_type='text/html')
    else:
        route.fulfill(status=404)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('SLOT_BROWSER_EXECUTABLE')
        or shutil.which('chromium') or shutil.which('google-chrome'),
        headless=True, args=['--no-sandbox'],
    )
    for width, height in [(320, 568), (360, 700), (390, 844), (430, 740)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route(URL + '**', serve)
        page.goto(URL)
        page.get_by_test_id('dark-cave-floor-scroll').wait_for()
        page.get_by_test_id('dark-cave-challenge').wait_for()
        measurements = page.evaluate("""() => {
          const box = id => document.querySelector('[data-testid="' + id + '"]').getBoundingClientRect();
          const floor = box('dark-cave-floor-list');
          const actions = box('dark-cave-actions');
          const challenge = box('dark-cave-challenge');
          const scroll = document.querySelector('[data-testid="dark-cave-floor-scroll"]');
          return {
            floorHeight: floor.height, floorBottom: floor.bottom,
            actionsTop: actions.top, challengeBottom: challenge.bottom,
            scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        }""")
        assert measurements['floorHeight'] >= 156, f'Fewer than three cave floors visible at {width}x{height}: {measurements}'
        assert measurements['scrollHeight'] > measurements['clientHeight'], f'Floors cannot scroll: {measurements}'
        assert measurements['floorBottom'] <= measurements['actionsTop'] + 2, f'Floors overlap Challenge: {measurements}'
        assert measurements['challengeBottom'] <= height - 60, f'Challenge hidden behind nav: {measurements}'
        assert not measurements['horizontalOverflow'], f'Horizontal overflow at {width}x{height}'
        assert page.get_by_test_id('dark-cave-challenge').is_visible(), 'Single Challenge must be visible'
        assert page.get_by_text('Добавить благословение').count() == 0, 'Do not advertise nonexistent blessing mechanics'
        assert page.get_by_text('Режим боя').count() == 0, 'Do not expose battle mode before the fight'
        assert page.get_by_test_id('dark-cave-visual').is_visible(), 'The cavern backdrop must be present'
        floor_scroll = page.get_by_test_id('dark-cave-floor-scroll')
        floor_scroll.evaluate('(element) => { element.scrollTop = element.scrollHeight; }')
        assert floor_scroll.evaluate('(element) => element.scrollTop > 0'), 'Touch-scroll floor list must move'
        page.get_by_role('button', name='Мой этаж').click()
        if width == 320:
            page.get_by_test_id('dark-cave-challenge').click()
            assert page.evaluate('window.__adventureCalls.filter(c => c.action === "start").length') == 1, 'Challenge must start exactly one server request'
        assert not errors, f'Browser errors: {errors}'
        page.close()
    browser.close()
print('Compact Dark Cave: 320/360/390/430 floor list, touch scroll, action visibility, one start: PASS (offline fixture)')
