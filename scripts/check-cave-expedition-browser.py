"""Offline browser acceptance: real touch controls, four widths, all route pairs."""
import json
import os
import shutil
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/cave-expedition/evidence'
OUT.mkdir(parents=True, exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'artifacts/cave-expedition')))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}'

def state(page): return page.evaluate('({phase:__caveDemo.world.phase,room:__caveDemo.world.room,biome:__caveDemo.world.biome,hp:__caveDemo.world.hp,kills:__caveDemo.world.kills,x:__caveDemo.world.heroX,camera:__caveDemo.world.cameraX})')
manual_control=False
def step(page, seconds):
    if manual_control:
        decision=page.evaluate("""()=>{const w=__caveDemo.world;const boss=w.enemies.find(e=>e.species==='boss'&&e.hp>0);return {ward:boss&&boss.heavy&&boss.impact>w.time&&w.shieldUntil<=w.time,heal:w.hp<600,cleave:w.enemies.filter(e=>e.hp>0).length>1&&w.energy>=54}}""")
        for key,label in [('ward','Заслон'),('heal','Источник'),('cleave','Раскол')]:
            button=page.get_by_role('button',name=label,exact=True)
            if decision.get(key) and button.is_enabled(): button.tap()
    page.evaluate('(s)=>__caveDemo.step(s)', seconds)
    page.wait_for_timeout(125)
def until(page, wanted, limit=200):
    for _ in range(limit):
        if state(page)['phase'] == wanted: return
        step(page, .75)
    raise AssertionError(state(page))
def visible(page):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1'), 'No document scroll'
    for element in page.locator('.cx-actions button, .cx-nav button, .cx-portals button').all():
        box = element.bounding_box()
        assert box and box['x']>=0 and box['y']>=0 and box['x']+box['width']<=page.viewport_size['width']+1 and box['y']+box['height']<=page.viewport_size['height']+1
        assert box['height'] >= 44

def screenshot(page, width, name):
    visible(page)
    page.screenshot(path=str(OUT / f'{width}-{name}.png'))

reports=[]
try:
  with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium') or shutil.which('google-chrome'), headless=True, args=['--no-sandbox'])
    for width, first, second in [(320,0,0),(360,0,1),(390,1,0),(430,1,1)]:
      context=browser.new_context(viewport={'width':width,'height':720},device_scale_factor=1,is_mobile=True,has_touch=True)
      page=context.new_page(); errors=[]; external=[]
      page.on('pageerror',lambda e:errors.append(str(e)))
      page.on('request',lambda req: external.append(req.url) if not req.url.startswith((URL,'data:')) else None)
      page.goto(URL+'/test-fixture.html');page.wait_for_function('()=>window.__caveDemo')
      screenshot(page,width,'lobby')
      page.get_by_role('button',name='Играть DEMO').tap();step(page,2)
      assert state(page)['x']>320 and state(page)['camera']>50
      screenshot(page,width,'run')
      assert page.locator('.cx-focus').count()==1
      assert page.locator('.cx-stage').bounding_box()['height'] / page.viewport_size['height'] > .5
      page.get_by_role('button',name='Звук',exact=True).tap();assert page.get_by_role('button',name='Звук',exact=True).get_attribute('aria-pressed')=='false'
      page.get_by_role('button',name='Звук',exact=True).tap()
      # Pause via actual UI: no world change while paused.
      page.get_by_role('button',name='Пауза',exact=True).tap();before=state(page);step(page,2);assert state(page)==before
      page.get_by_role('button',name='Продолжить путь').tap()
      until(page,'FIGHT');screenshot(page,width,'fight')
      hp=page.evaluate('__caveDemo.world.enemies.reduce((n,e)=>n+e.hp,0)')
      page.get_by_role('button',name='Раскол',exact=True).tap()
      assert page.evaluate('__caveDemo.world.enemies.reduce((n,e)=>n+e.hp,0)') < hp
      manual_control=width==390
      if not manual_control: page.get_by_role('button',name='Авто',exact=False).tap()
      until(page,'PORTAL_CHOICE');assert state(page)['kills']==6;screenshot(page,width,'portals-1')
      assert page.locator('.cx-portals button').count()==2
      before=state(page);step(page,2);assert state(page)['x']==before['x']
      page.locator('.cx-portals .cx-portal-touch').nth(first).tap();step(page,.5);assert state(page)['x']>before['x']
      screenshot(page,width,'portal-enter')
      until(page,'RUN_RIGHT');assert state(page)['biome']==('ember' if first else 'spore');screenshot(page,width,'room-2')
      until(page,'PORTAL_CHOICE');assert state(page)['kills']==12;screenshot(page,width,'portals-2')
      page.locator('.cx-portals .cx-portal-touch').nth(second).tap()
      until(page,'BOSS');assert state(page)['biome']==('forge' if second else 'astral');step(page,4)
      screenshot(page,width,'boss')
      until(page,'VICTORY');assert state(page)['kills']==16
      assert page.evaluate('__caveDemo.world.blocks')>0
      manual_control=False
      screenshot(page,width,'victory')
      assert page.get_by_text('Превью возможных наград · без выдачи').is_visible()
      page.get_by_role('button',name='Повторить забег').tap();assert state(page)['kills']==0 and state(page)['room']==0
      until(page,'FIGHT');page.evaluate('__caveDemo.world.hp=1');until(page,'DEFEAT');screenshot(page,width,'defeat')
      page.get_by_role('button',name='Повторить забег').tap();assert state(page)['hp']==900
      page.get_by_role('button',name='Вернуться ко входу').tap();page.get_by_role('button',name='К входному порталу').tap();assert state(page)['phase']=='LOBBY'
      # Test actual visibility handler and cleanup on a live loop.
      page.get_by_role('button',name='Играть DEMO').tap();step(page,2)
      page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
      before=state(page);page.wait_for_timeout(250);assert state(page)==before
      page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
      page.wait_for_timeout(200);assert state(page)['x']>before['x']
      page.evaluate('__caveDemo.unmount()');before=state(page);page.wait_for_timeout(200);assert state(page)==before
      assert not errors,errors
      assert not external,external
      reports.append({'width':width,'route':[first,second],'result':'PASS','external_requests':len(external)})
      context.close()
      print(f'PASS {width}: run, 2 portal touches, 3 rooms, boss, victory, defeat, restart, visibility, unmount, 0 external requests',flush=True)
    # Delivery HTML has no debug fixture and still works with all requests blocked.
    context=browser.new_context(viewport={'width':360,'height':640},is_mobile=True,has_touch=True)
    page=context.new_page();page.goto(URL+'/territory-cave-demo.html');page.get_by_role('button',name='Играть DEMO').wait_for();context.set_offline(True)
    assert page.evaluate('typeof window.__caveDemo')=='undefined'
    page.get_by_role('button',name='Играть DEMO').tap();page.wait_for_timeout(1000);visible(page)
    context.close()
    # English, reduced motion, reload/re-entry, short and landscape viewports.
    for width,height in [(360,640),(320,568),(360,808),(640,360)]:
      context=browser.new_context(viewport={'width':width,'height':height},is_mobile=True,has_touch=True,device_scale_factor=2 if height==808 else 1,reduced_motion='reduce')
      page=context.new_page();page.goto(URL+'/test-fixture.html?lang=en');page.wait_for_function('()=>window.__caveDemo')
      page.get_by_role('button',name='Play DEMO').tap();step(page,2);visible(page)
      assert page.get_by_role('button',name='Auto skills').is_visible()
      if width>height:
        stage=page.locator('.cx-stage').bounding_box();controls=page.locator('.cx-controls').bounding_box()
        assert stage['x']+stage['width']<=controls['x']+1,'Landscape controls never cover actors'
        page.screenshot(path=str(OUT/'640-landscape.png'))
      page.get_by_role('button',name='How to play').tap();before=state(page);step(page,1);assert state(page)==before
      page.get_by_role('button',name='Got it').tap()
      page.reload();page.get_by_role('button',name='Play DEMO').wait_for();assert state(page)['phase']=='LOBBY'
      page.get_by_role('button',name='Play DEMO').tap();step(page,2);visible(page)
      context.close()
    browser.close()
finally:
    server.shutdown()
(OUT/'browser-report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
print('PASS self-contained delivery HTML: offline, no debug control, 360x640',flush=True)
