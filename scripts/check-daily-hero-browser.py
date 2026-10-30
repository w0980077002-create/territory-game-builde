"""Integrated daily hero loop: real React components, fake local statuses, no rewards granted."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os, shutil, threading
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = path.split('?')[0]
        asset = os.path.join(os.getcwd(), 'public', name.lstrip('/'))
        return asset if os.path.isfile(asset) else super().translate_path(path)
    def log_message(self, *args): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome'), args=['--no-sandbox'])
        for width in (320, 360, 390, 430):
            for language in ('ru', 'en'):
                page = browser.new_page(viewport={'width': width, 'height': 650}, reduced_motion='reduce')
                page.add_init_script(f"localStorage.setItem('territory-language','{language}')")
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                start = f'http://127.0.0.1:{server.server_port}/territory-daily-hero-preview.html'
                page.goto(start+'?view=events')
                goal = page.locator('[data-testid=events-daily-focus]')
                goal.wait_for()
                assert goal.locator('button').bounding_box()['height'] >= 43.99, 'primary hero action is too small'
                assert goal.locator('h3').inner_text() == ('Забери награду дня' if language=='ru' else 'Claim today’s reward')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Events horizontal overflow'
                goal.locator('button').click()
                feature = page.locator('[data-testid=daily-current-reward]')
                feature.wait_for()
                assert feature.locator('strong').inner_text() == ('День 1 из 7' if language=='ru' else 'Day 1 of 7')
                assert page.get_by_role('dialog').count()==1
                assert not page.evaluate('Boolean(window.__notice)'), 'opening calendar cannot grant a reward'
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Daily sheet overflow'
                page.get_by_role('dialog').locator('.territory-modal-close').click()
                goal.wait_for()
                assert not errors, f'Events / reward browser error: {errors}'
                page.goto(start+'?view=events&claimed=1&quests=1')
                goal=page.locator('[data-testid=events-daily-focus]')
                assert goal.locator('h3').inner_text()==('Задание уже выполнено' if language=='ru' else 'A quest is completed')
                goal.locator('button').click()
                assert page.evaluate('window.__route') == 'quests'
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.goto(start+'?view=hall')
                next_game=page.locator('[data-testid=hall-next-play]')
                next_game.wait_for()
                assert next_game.locator('.hall-hero-mission__art img').count()==1
                assert next_game.bounding_box()['height']>=130
                next_game.click()
                assert page.evaluate('window.__hallGame')=='monopoly'
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Game Hall overflow'
                page.goto(start+'?view=hall&active=1')
                resume=page.locator('[data-testid=resume-hall]')
                resume.wait_for()
                assert ('СОХРАНЕНА' if language=='ru' else 'SAVED') in resume.inner_text().upper()
                resume.click()
                assert page.evaluate('window.__hallGame')=='treasury', 'hidden legacy session must remain resumable'
                page.goto(start+'?view=hall&offline=1')
                page.get_by_role('alert').wait_for()
                wheel=page.locator('[data-testid=hall-game-wheel]')
                assert wheel.is_enabled(), 'Wheel receipt recovery must survive Hall read failure'
                wheel.click()
                assert page.evaluate('window.__hallGame')=='wheel'
                assert not errors, f'Offline Hall browser error: {errors}'
                page.close()
        browser.close()
finally:
    server.shutdown()
print('Integrated daily hero loop PASS: Events → reward sheet, quests, Hall Monopoly, hidden saved session, offline Wheel; 320/360/390/430 RU/EN, no live transactions.')
