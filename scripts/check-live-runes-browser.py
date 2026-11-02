"""Browser acceptance of the real server rune component with an isolated synthetic ledger."""
import os, threading, shutil
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def translate_path(self, path):
        asset = os.path.join(os.getcwd(), 'public', path.lstrip('/').split('?')[0])
        return asset if os.path.isfile(asset) else super().translate_path(path)

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
os.makedirs('/tmp/territory-rune-screenshots', exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for lang in ('ru', 'en'):
            page = browser.new_page(viewport={'width':width,'height':720}, reduced_motion='reduce')
            page.add_init_script("localStorage.setItem('territory-language', '" + lang + "');")
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:' + str(server.server_port) + '/territory-live-runes-preview.html')
            page.get_by_test_id('territory-server-rune-book').wait_for()
            assert page.locator('.territory-rune__tile').count() == 15
            assert page.locator('.territory-rune__row').count() == 5
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow on board'
            if width == 390:
                page.screenshot(path='/tmp/territory-rune-screenshots/board-' + lang + '.png', full_page=True)

            slot = page.get_by_test_id('rune-slot-9')
            slot.click()
            dialog = page.get_by_role('dialog')
            assert dialog.is_visible()
            assert dialog.get_by_test_id('rune-option-0').count() == 1
            assert dialog.get_by_test_id('rune-option-1').count() == 1
            assert dialog.get_by_test_id('rune-option-2').count() == 1
            assert dialog.get_by_role('button', name=('Close' if lang == 'en' else 'Закрыть')).bounding_box()['width'] >= 44
            assert dialog.bounding_box()['y'] >= 0
            assert dialog.bounding_box()['y'] + dialog.bounding_box()['height'] <= 720
            if width == 390:
                page.screenshot(path='/tmp/territory-rune-screenshots/dialog-' + lang + '.png')

            dialog.get_by_test_id('rune-option-1').click()
            assert dialog.get_by_test_id('rune-option-1').get_attribute('aria-pressed') == 'true'
            assert (('Not saved' in slot.inner_text()) if lang == 'en' else ('Не сохранено' in slot.inner_text())), 'Draft must not be marked server-equipped'
            # A daily claim reloads the confirmed loadout: unsaved selections
            # must never disappear silently during that refresh.
            daily = page.get_by_test_id('rune-daily-claim')
            assert daily.is_disabled(), 'Daily claim must wait for a saved build'
            assert (('Save build first' in daily.inner_text()) if lang == 'en' else ('Сначала сохрани сборку' in daily.inner_text()))
            dialog.get_by_role('button', name=('Save build' if lang == 'en' else 'Сохранить сборку')).click()
            page.wait_for_function("""() => {
              const selected = document.querySelector('[data-testid="rune-slot-9"]');
              return selected && (selected.textContent.includes('Установлено') || selected.textContent.includes('Equipped'));
            }""")
            dialog.get_by_role('button', name=('Close' if lang == 'en' else 'Закрыть')).click()
            page.get_by_test_id('rune-daily-claim').click()
            page.get_by_test_id('rune-daily-receipt').wait_for()
            assert page.get_by_test_id('rune-daily-claim').is_disabled()
            assert not errors, 'Browser errors: ' + str(errors)
            page.close()
    browser.close()
server.shutdown()
print('Real server-rune component PASS (isolated ledger): 320/360/390/430 RU/EN; 15 slots; 3 options; save; daily receipt; mobile modal')
