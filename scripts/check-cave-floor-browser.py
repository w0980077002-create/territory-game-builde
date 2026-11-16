"""Four-section floor acceptance against the real component, never a server account."""
import json, os, shutil, threading
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];out=root/'artifacts/cave-expedition/evidence';out.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root/'artifacts/cave-expedition')));threading.Thread(target=server.serve_forever,daemon=True).start()
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium'),args=['--no-sandbox'])
 for width,route in [(320,[0,0,0,0]),(360,[1,1,1,1]),(390,[2,2,2,2]),(430,[0,2,1,2])]:
  ctx=browser.new_context(viewport={'width':width,'height':640},is_mobile=True,has_touch=True);page=ctx.new_page();errors=[];requests=[]
  page.on('dialog',lambda d:d.accept());page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url) if not r.url.startswith(('http://127.0.0.1','data:')) else None)
  page.goto(f'http://127.0.0.1:{server.server_port}/test-fixture.html');page.wait_for_function('()=>window.__caveDemo')
  page.evaluate("localStorage.setItem('player-sentinel','unchanged')")
  page.get_by_role('button',name='В путь').tap();assert page.get_by_role('button',name='Авто навыков',exact=True).get_attribute('aria-pressed')=='true'
  choices=0;restored=False
  for step in range(1000):
   w=page.evaluate('({phase:__caveDemo.world.phase,stars:__caveDemo.world.stars,kills:__caveDemo.world.kills,hp:__caveDemo.world.hp,unlocked:__caveDemo.world.unlockedFloor})')
   if w['phase']=='VICTORY':break
   assert w['phase']!='DEFEAT',w
   assert w['unlocked']==1,w
   if w['phase']=='PORTAL_CHOICE':
    page.wait_for_timeout(120);assert page.locator('.cx-portals button').count()==3
    assert w['kills']==sum(9+s for s in route[:choices])
    for btn in page.locator('.cx-portals button').all():
     box=btn.bounding_box();assert box['height']>=44 and box['x']>=0 and box['x']+box['width']<=width+1
    assert page.get_by_test_id('cx-umbra-slot').count()==12;assert page.get_by_test_id('cx-wings-slot').count()==1;assert page.locator('.cx-native-nav button').count()==7
    page.screenshot(path=str(out/f'{width}-floor-portal-{choices+1}.png'))
    page.locator('.cx-portals button').nth(route[choices]).tap();choices+=1
   if choices==2 and not restored and w['phase']=='FIGHT':
    page.get_by_role('button',name='Пауза',exact=True).tap();before=page.evaluate('JSON.stringify(__caveDemo.world)')
    page.reload();page.wait_for_function('()=>window.__caveDemo');assert page.evaluate('JSON.stringify(__caveDemo.world)')==before
    page.get_by_role('button',name='Продолжить путь',exact=True).tap();restored=True
   page.evaluate('__caveDemo.step(1.5)');page.wait_for_timeout(25)
  assert choices==4 and w['phase']=='VICTORY',w
  page.wait_for_timeout(150);assert w['kills']==sum(9+s for s in route)+1;page.screenshot(path=str(out/f'{width}-floor-victory.png'))
  bank=lambda:json.loads(page.evaluate("localStorage.getItem('territory_cave_sandbox_v1')"))
  before=bank();assert before['playtestWins']==1
  page.reload();page.wait_for_function('()=>window.__caveDemo');page.wait_for_timeout(150);assert bank()==before
  page.get_by_role('button',name='Открыть добычу',exact=True).tap();page.get_by_test_id('umbra-item').first.tap();page.get_by_test_id('umbra-dismantle').tap();assert len(bank()['items'])==len(before['items'])-1
  remaining=bank();page.locator('.cx-native-nav').get_by_role('button',name='Бой',exact=True).tap();page.get_by_role('button',name='Следующий этаж').tap()
  assert page.evaluate('__caveDemo.world.floor')==2 and page.evaluate('__caveDemo.world.stars.length')==0
  assert bank()==remaining,'Starting next floor must preserve the preceding reward receipt'
  assert page.evaluate("localStorage.getItem('player-sentinel')")=='unchanged';assert not errors,errors;assert not requests,requests
  reports.append({'width':width,'route':route,'kills':w['kills'],'reload':restored,'external_requests':len(requests),'result':'PASS'});print(reports[-1],flush=True);ctx.close()
 for width,height in [(320,568),(640,360)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=True,has_touch=True,reduced_motion='reduce');page=ctx.new_page()
  page.goto(f'http://127.0.0.1:{server.server_port}/test-fixture.html?lang=en');page.get_by_role('button',name='Set out').tap();page.locator('.cx-portals button').first.wait_for()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1')
  for btn in page.locator('.cx-portals button').all():
   box=btn.bounding_box();assert box['height']>=44 and box['x']>=0 and box['x']+box['width']<=width+1 and box['y']>=0 and box['y']+box['height']<=height+1
  page.screenshot(path=str(out/f'{width}x{height}-floor-en.png'));ctx.close()
 browser.close()
server.shutdown();(out/'floor-browser-report.json').write_text(json.dumps(reports,indent=2))
