"""Real quests and inbox; synthetic state, network and claims are disabled."""
import os,shutil,threading
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
   page=browser.new_page(viewport={'width':width,'height':500},reduced_motion='reduce');page.add_init_script(f"localStorage.setItem('territory-language','{lang}')");errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(f'http://127.0.0.1:{server.server_port}/territory-journal-after.html?quests');page.wait_for_timeout(300);assert not errors,errors
   action=page.locator('.viking-screen--quests button.min-h-11').last;assert action.count()==1 and action.bounding_box()['height']>=43.99;action.click();assert page.evaluate('!!window.__route')
   page.goto(f'http://127.0.0.1:{server.server_port}/territory-journal-after.html?quests-veteran');page.wait_for_timeout(300)
   featured=page.get_by_role('region',name='Next quest' if lang=='en' else 'Следующее задание');assert featured.count()==1;title=featured.locator('h4').inner_text();assert page.locator('.viking-screen--quests h4').filter(has_text=title).count()==1;featured.get_by_role('button').click();assert page.evaluate('!!window.__route');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.goto(f'http://127.0.0.1:{server.server_port}/territory-journal-after.html?mail');page.wait_for_timeout(300);assert not errors,errors
   tabs=page.locator('.territory-mail__tabs [role="tab"]');assert tabs.count()==2 and tabs.first.bounding_box()['height']>=43.99;tabs.last.click();assert tabs.last.get_attribute('aria-selected')=='true';tabs.first.click();assert tabs.first.get_attribute('aria-selected')=='true'
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.close()
 browser.close()
server.shutdown()
print('Quests and mail browser checks passed: local state, no claim, 320/360/390/430, RU/EN.')
