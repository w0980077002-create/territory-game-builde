"""Real workshop, shop and profession screens; all transport and purchases are stubbed."""
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
    page=browser.new_page(viewport={'width':width,'height':500},reduced_motion='reduce');page.add_init_script(f"localStorage.setItem('territory-language','{lang}')" + (";document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('territory-ios-webapp'))" if ios else ''));errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}/territory-workshop-after.html?forge');page.wait_for_timeout(400);assert not errors,errors
    gear=page.get_by_role('button',name='Iron Helmet' if lang=='en' else 'Железный шлем');gear.click();dialog=page.get_by_role('dialog');close=dialog.get_by_role('button',name='Close' if lang=='en' else 'Закрыть');r=close.bounding_box();assert r['width']>=44 and r['height']>=44,(width,lang,ios,r)
    assert close.evaluate('(e)=>document.activeElement===e');page.keyboard.press('Escape');assert dialog.count()==0 and gear.evaluate('(e)=>document.activeElement===e')
    page.goto(f'http://127.0.0.1:{server.server_port}/territory-workshop-after.html?shop');page.wait_for_timeout(400);assert not errors,errors
    item=page.get_by_role('button').filter(has_text='Health Potion' if lang=='en' else 'Зелье здоровья').first;item.click();dialog=page.get_by_role('dialog');assert ('Health Potion' if lang=='en' else 'Зелье здоровья') in dialog.locator('h2').inner_text();close=dialog.locator('.territory-modal-close');assert close.bounding_box()['height']>=44
    plus=dialog.get_by_role('button',name='Increase quantity' if lang=='en' else 'Увеличить количество');assert plus.bounding_box()['width']>=44;plus.click();assert dialog.locator('input[type="range"]').input_value()=='2';page.keyboard.press('Escape');assert dialog.count()==0 and item.evaluate('(e)=>document.activeElement===e')
    page.goto(f'http://127.0.0.1:{server.server_port}/territory-workshop-after.html?professions');page.wait_for_timeout(300);assert not errors,errors
    assert page.locator('.profession-choice').count()==5;assert page.locator('.profession-choice__action').first.bounding_box()['height']>=44
    page.get_by_role('tab',name='Crafting' if lang=='en' else 'Крафт').click();assert page.locator('.profession-choice').count()==0
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.close()
 browser.close()
server.shutdown()
print('Workshop browser checks passed: real forge, shop and professions with inert transport, 320/360/390/430, RU/EN.')
