"""Production result card in a synthetic scene, no arena transport."""
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
   for mode in ('win','draw','loss'):
    page=browser.new_page(viewport={'width':width,'height':500},reduced_motion='reduce');page.add_init_script(f"localStorage.setItem('territory-language','{lang}')");page.goto(f'http://127.0.0.1:{server.server_port}/arena-result-preview.html?m={mode}')
    button=page.get_by_role('button',name='Leave arena' if lang=='en' else 'Покинуть арену');rect=button.bounding_box();assert rect['height']>=43.99 and rect['width']>=43.99,rect
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');button.click();assert page.evaluate('window.__exit===true');page.close()
 browser.close()
server.shutdown()
print('Arena result browser checks passed: three results, synthetic rewards, 320/360/390/430, RU/EN.')
