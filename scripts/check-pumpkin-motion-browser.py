"""Offline component-motion smoke. Input is synthetic; this is not PvE or Telegram E2E."""
import os,threading
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        asset=os.path.join(os.getcwd(),'public',path.lstrip('/').split('?')[0])
        return asset if os.path.isfile(asset) else super().translate_path(path)
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory='/tmp'))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
    browser=p.chromium.launch(args=['--no-sandbox'])
    for motion in ('no-preference','reduce'):
        page=browser.new_page(viewport={'width':320,'height':600},reduced_motion=motion)
        page.goto(f'http://127.0.0.1:{server.server_port}/territory-pumpkin-motion.html')
        page.locator('.pumpkin-witch__figure').wait_for()
        assert page.locator('.pumpkin-witch__preload img').count()==2
        assert page.locator('.pumpkin-witch__figure').evaluate('(el)=>el.complete && el.naturalWidth > 0')
        page.get_by_role('button',name='appear').click()
        appear=page.locator('.pumpkin-witch__effect--appear')
        assert appear.count()==1
        capture=os.environ.get('TERRITORY_MOTION_SCREENSHOTS_DIR')
        if capture and motion=='no-preference':
            os.makedirs(capture,exist_ok=True)
            page.wait_for_timeout(80)
            page.locator('.pumpkin-witch').screenshot(path=os.path.join(capture,'appearance.png'))
        page.get_by_role('button',name='attack').click()
        pose=page.locator('.pumpkin-witch__action-pose')
        assert pose.get_attribute('src').endswith('/attack.webp')
        assert page.locator('.pumpkin-witch__effect--attack').count()==1
        if capture and motion=='no-preference':
            page.wait_for_function("document.querySelector('.pumpkin-witch__action-pose').naturalWidth > 0")
            page.wait_for_timeout(80)
            page.locator('.pumpkin-witch').screenshot(path=os.path.join(capture,'attack.png'))
        page.get_by_role('button',name='heal').click()
        assert pose.get_attribute('src').endswith('/heal.webp')
        assert page.locator('.pumpkin-witch__effect--attack').count()==1
        assert page.locator('.pumpkin-witch__effect--heal').count()==1
        if capture and motion=='no-preference':
            page.wait_for_function("document.querySelector('.pumpkin-witch__action-pose').naturalWidth > 0")
            page.wait_for_timeout(80)
            page.locator('.pumpkin-witch').screenshot(path=os.path.join(capture,'heal.png'))
        if motion=='reduce':
            assert page.locator('.pumpkin-witch__figure').evaluate('(el)=>getComputedStyle(el).opacity') == '1'
            assert pose.evaluate('(el)=>getComputedStyle(el).display')=='none'
            assert page.locator('.pumpkin-witch__body').evaluate('(el)=>getComputedStyle(el).animationName')=='none'
        else:
            assert page.locator('.pumpkin-witch__figure').evaluate('(el)=>getComputedStyle(el).opacity') == '0'
            assert pose.evaluate('(el)=>getComputedStyle(el).display')!='none'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.close()
    browser.close()
server.shutdown()
print('Pumpkin Witch motion component smoke passed: distinct poses, simultaneous effects, preload and reduced motion (synthetic input).')
