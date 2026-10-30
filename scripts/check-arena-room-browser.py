"""Actual ArenaRoom with stubbed transport and battle scene; never contacts a server."""
import os,threading
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        asset=os.path.join(os.getcwd(),'public',path.lstrip('/').split('?')[0]);return asset if os.path.isfile(asset) else super().translate_path(path)
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory='/tmp'));threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for width in (320,360,390,430):
        for lang in ('ru','en'):
            page=browser.new_page(viewport={'width':width,'height':500},reduced_motion='reduce');page.add_init_script(f"localStorage.setItem('territory-language','{lang}')")
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/arena-room-after.html');page.wait_for_timeout(400);assert not errors,errors
            trigger=page.get_by_role('button',name='Leave battle' if lang=='en' else 'Покинуть бой');trigger.click()
            dialog=page.get_by_role('alertdialog');close=dialog.get_by_role('button',name='Close' if lang=='en' else 'Закрыть');rect=close.bounding_box();assert rect['width']>=44 and rect['height']>=44,rect
            assert dialog.get_by_role('button',name='Stay' if lang=='en' else 'Остаться').evaluate('(el)=>document.activeElement===el')
            head=dialog.locator('.arena-leave-head').bounding_box();title=dialog.locator('#arena-leave-title').bounding_box()
            assert abs((head['x']+head['width']/2)-(title['x']+title['width']/2))<1
            close.focus();page.keyboard.press('Shift+Tab')
            assert dialog.get_by_role('button',name='Leave' if lang=='en' else 'Выйти').evaluate('(el)=>document.activeElement===el')
            page.keyboard.press('Escape');assert dialog.count()==0 and trigger.evaluate('(el)=>document.activeElement===el');assert page.evaluate('window.__leaveCalls||0')==0
            trigger.click();close.click();assert dialog.count()==0 and page.evaluate('window.__leaveCalls||0')==0
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.close()
    browser.close()
server.shutdown()
print('Arena leave dialog browser checks passed: actual room with synthetic transport, 320/360/390/430, RU/EN.')
