"""Exercise the real cave UI with isolated fake server data, never a player account."""
from pathlib import Path
from urllib.parse import urlparse
import os, shutil
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
fixture = Path('/tmp/adventure-preview.html')
url = 'http://127.0.0.1:4175/'
out = Path('/tmp/umbra-screenshots')
out.mkdir(exist_ok=True)

def serve(route):
    path = urlparse(route.request.url).path
    if path == '/':
        route.fulfill(body=fixture.read_bytes(), content_type='text/html')
    else:
        asset = (root / 'public' / path.lstrip('/')).resolve()
        if asset.is_relative_to(root / 'public') and asset.is_file():
            route.fulfill(body=asset.read_bytes(), content_type='image/webp')
        else:
            route.fulfill(status=404)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('SLOT_BROWSER_EXECUTABLE') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    for lang in ('ru', 'en'):
        for width, height in ((320,568),(360,740),(390,844),(430,932)):
            page = browser.new_page(viewport={'width':width,'height':height})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.route(url+'**', serve)
            page.goto(url+'?lang='+lang)
            page.get_by_test_id('open-umbra').click()
            screen = page.get_by_test_id('umbra-screen')
            assert screen.get_by_test_id('umbra-slot').count() == 12
            assert screen.get_by_test_id('umbra-item').count() == 16
            page.screenshot(path=str(out / f'umbra-{lang}-{width}.png'))
            before = page.evaluate('JSON.stringify(localStorage)')
            calls = page.evaluate('JSON.stringify(window.__adventureCalls)')
            for i in range(12):
                screen.get_by_test_id('umbra-slot').nth(i).click()
                page.get_by_role('dialog').wait_for()
                page.get_by_role('button', name='Close' if lang == 'en' else 'Закрыть').click()
            for i in range(16):
                screen.get_by_test_id('umbra-item').nth(i).click()
                page.get_by_role('dialog').wait_for()
                assert page.get_by_role('dialog').locator('img').evaluate('(img) => img.complete && img.naturalWidth > 0'), 'Artwork failed to load'
                scroll = screen.evaluate('(e) => e.scrollTop')
                page.get_by_role('button', name='Close' if lang == 'en' else 'Закрыть').click()
                assert screen.evaluate('(e) => e.scrollTop') == scroll, 'Closing detail changed storage scroll'
            for label, count in (('Gear' if lang == 'en' else 'Вещи',11), ('Gems' if lang == 'en' else 'Самоцветы',3), ('Materials' if lang == 'en' else 'Материалы',2), ('All' if lang == 'en' else 'Все',16)):
                screen.get_by_role('button', name=label, exact=True).click()
                assert screen.get_by_test_id('umbra-item').count() == count
            for label in (['Guide','Dismantle','Enhance all'] if lang == 'en' else ['Справочник','Разобрать','Усилить в один клик']):
                screen.get_by_role('button',name=label,exact=True).click()
                page.get_by_role('dialog').wait_for()
                page.keyboard.press('Escape')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.evaluate('JSON.stringify(localStorage)') == before
            assert page.evaluate('JSON.stringify(window.__adventureCalls)') == calls
            assert not errors, errors
            page.get_by_role('button',name='Back to cave' if lang == 'en' else 'Назад в пещеру').click()
            assert page.get_by_test_id('dark-cave-challenge').is_visible()
            page.close()
    browser.close()
print('Umbra UI PASS: 12 slots, 16 cards, filters, information, navigation, RU/EN, four viewports, no storage or server actions')
