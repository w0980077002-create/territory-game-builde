"""Real community-quest component in a fake transport: mobile, RU/EN, retry and server-confirmed UI."""
import os
import shutil
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/assets/') or path.startswith('/ic-') or path.startswith('/nav-'):
            return os.path.join(os.getcwd(), 'public', path.lstrip('/'))
        return super().translate_path(path)

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/territory-social-quests-preview.html'
os.makedirs('/tmp/social-quests-screenshots', exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for language in ('ru', 'en'):
            for ios in (False, True):
                page = browser.new_page(viewport={'width':width,'height':568 if width == 320 else 740})
                page.add_init_script(f"localStorage.setItem('territory-language','{language}'); window.__failSocialStatus=true;")
                if ios:
                    page.add_init_script("document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('territory-ios-webapp'))")
                page.goto(url)
                board = page.get_by_test_id('social-quests-section')
                board.wait_for()
                trail = page.get_by_test_id('social-journey')
                trail.wait_for()
                assert trail.locator('button[aria-current="page"]').count() == 1
                assert trail.locator('button[aria-current="page"]').is_disabled()
                trail.get_by_role('button', name='Clan' if language=='en' else 'Клан').click()
                assert page.evaluate('window.__socialRoute') == 'clan', 'social navigation must use real route id'
                trail.get_by_role('button', name='Friends' if language=='en' else 'Друзья').click()
                assert page.evaluate('window.__socialRoute') == 'friends'
                for mode,target in [('reward','clan-boss-rewards'),('quest','clan-quests'),('boss','clan-boss'),('chat','clan-chat')]:
                    page.get_by_test_id('fixture-clan-modes').get_by_role('button', name=mode).click()
                    page.get_by_test_id('clan-next-step').get_by_role('button').click()
                    assert page.evaluate('window.__clanJump') == target, (language,mode,target)
                for button in trail.locator('button').all():
                    rect=button.bounding_box()
                    assert rect and rect['height']>=43.5, (width,language,ios,'social touch target',rect)
                    assert rect['x']>=-1 and rect['x']+rect['width']<=width+1, (width,language,ios,'social overflow',rect)
                retry = page.get_by_role('button', name='Retry loading quests' if language=='en' else 'Повторить загрузку заданий')
                retry.wait_for()
                assert page.evaluate('window.__socialStatusCalls') == 1, 'first status call must fail without fake rewards'
                assert page.evaluate('window.__socialClaimCalls || []') == [], 'failure cannot grant anything'
                retry.click()
                verify = page.get_by_role('button', name='Verify' if language=='en' else 'Проверить')
                verify.first.wait_for()
                assert verify.count() == 2, 'two unclaimed server tasks expected'
                assert page.evaluate('window.__socialStatusCalls') == 2
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width,language,ios,'overflow')
                for button in board.locator('button').all():
                    rect=button.bounding_box()
                    assert rect and rect['height']>=43.5, (width,language,ios,button.inner_text(),rect)
                    assert rect['x']>=-1 and rect['x']+rect['width']<=width+1, (width,language,ios,rect)
                board.get_by_role('button', name='Open' if language=='en' else 'Перейти').first.click()
                assert page.evaluate('window.__socialOpen') == 'chat'
                assert page.evaluate('window.__socialClaimCalls || []') == [], 'opening a link cannot claim rewards'
                verify.first.click()
                page.get_by_text('Claimed' if language=='en' else 'Получено', exact=True).first.wait_for()
                assert page.evaluate('window.__socialClaimCalls.length') == 1, 'exactly one mock server claim'
                assert page.evaluate('window.__lastSocialStatus.chat === true && window.__lastSocialStatus.news === false')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                if width==360 and ios:
                    page.screenshot(path=f'/tmp/social-quests-screenshots/community-{language}-360-ios.png', full_page=True)
                page.close()
    browser.close()
server.shutdown()
print('Social journey + community quests mobile PASS: real React components, mock transport, 320/360/390/430 RU/EN, iOS shell, 4 server-state priorities, retry and 44px actions.')
