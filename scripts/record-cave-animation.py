"""Real RAF combat recording from an explicit offline floor-21 starting fixture.
No engine stepping or artificial victories. Never a live account or physical TG.
"""
import os, shutil, threading, time
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/cave-expedition/animation-evidence';OUT.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT/'artifacts/cave-expedition')));threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium'),args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':390,'height':720},has_touch=True,is_mobile=True,record_video_dir=str(OUT),record_video_size={'width':390,'height':720})
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(f'http://127.0.0.1:{server.server_port}/test-fixture.html');page.wait_for_function('()=>window.__caveDemo')
 # Synthetic initial floor availability ONLY. All subsequent encounters, HP,
 # movement, contact, phases and victory advance through the actual UI/RAF.
 page.evaluate('__caveDemo.world.floor=21;__caveDemo.world.unlockedFloor=21')
 page.get_by_role('button',name='В путь').tap();page.get_by_role('button',name='Скорость',exact=True).tap()
 began=time.monotonic();last='';choices=0;seen=set();route=[1,0,2,0]
 while time.monotonic()-began<480:
  phase=page.locator('.cx-stage').get_attribute('data-phase')
  if phase!=last:print(f'{time.monotonic()-began:.1f}s {phase}',flush=True);last=phase
  stats=page.evaluate('({floor:__caveDemo.world.floor,boss:__caveDemo.world.bossSpawned,bossPhase:__caveDemo.world.bossPhase,enemies:__caveDemo.world.enemies.map(e=>e.species)})')
  assert stats['floor']==21
  if stats['boss']:seen.add(stats['bossPhase'])
  if phase=='PORTAL_CHOICE':
   page.wait_for_timeout(500);page.locator('.cx-portals button').nth(route[choices]).tap();choices+=1
  if phase in ['VICTORY','DEFEAT']:
   assert phase=='VICTORY' and choices==4 and seen=={1,2,3},(phase,choices,seen)
   page.wait_for_timeout(1500);break
  page.wait_for_timeout(200)
 else:raise AssertionError('Real-time floor did not finish')
 assert not errors,errors
 video=page.video;context.close();video.save_as(str(OUT/'real-combat-floor21-390.webm'));browser.close()
server.shutdown();print('PASS real RAF floor 21: four sections, boar, queen phases 1/2/3, victory. Offline synthetic initial progress; no stepping.',flush=True)
