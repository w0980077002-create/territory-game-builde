"""Real rune preview, no saved or server-backed selection."""
import os,threading,shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
class Handler(SimpleHTTPRequestHandler):
 def translate_path(self,path):
  asset=os.path.join(os.getcwd(),'public',path.lstrip('/').split('?')[0]);return asset if os.path.isfile(asset) else super().translate_path(path)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory='/tmp'));threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 for width in (320,360,390,430):
  for lang in ('ru','en'):
   for ios in (False,True):
    page=browser.new_page(viewport={'width':width,'height':500},reduced_motion='reduce');page.add_init_script(f"localStorage.setItem('territory-language','{lang}')" + (";document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('territory-ios-webapp'))" if ios else ''));page.goto(f'http://127.0.0.1:{server.server_port}/territory-runes-after.html')
    skill=page.locator('.rune-book__skill').first;skill.click();dialog=page.get_by_role('dialog');close=dialog.get_by_role('button',name='Close' if lang=='en' else 'Закрыть');box=close.bounding_box();assert box['width']>=43.99 and box['height']>=43.99
    assert dialog.bounding_box()['y'] >= 0 and dialog.bounding_box()['y'] + dialog.bounding_box()['height'] <= 501
    title=dialog.locator('.rune-book__dialog-top > div').bounding_box();head=dialog.locator('.rune-book__dialog-top').bounding_box();assert abs((title['x']+title['width']/2)-(head['x']+head['width']/2))<1
    assert dialog.locator('.rune-book__dialog-body').evaluate('(e)=>e.scrollHeight>e.clientHeight');assert close.evaluate('(e)=>document.activeElement===e');page.keyboard.press('Escape');assert dialog.count()==0 and skill.evaluate('(e)=>document.activeElement===e')
    skill.click();dialog.locator('.rune-book__rune-option').last.scroll_into_view_if_needed();dialog.locator('.rune-book__rune-option').last.click();assert dialog.locator('.rune-book__rune-option[aria-pressed="true"]').count()==1
    close.click();assert dialog.count()==0 and page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.close()
 browser.close()
server.shutdown()
print('Rune preview dialog checks passed: 320/360/390/430, RU/EN, scroll, selection and focus; no server.')
