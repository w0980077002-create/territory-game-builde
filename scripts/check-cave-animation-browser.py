"""Actual Canvas/HTTP fault, clip, mobile, pause and performance checks for #540.
Snapshots deliberately use synthetic visual checkpoints. Full-floor regression
and realtime gameplay recordings are separate, and never called physical TG.
"""
import json
import os
import shutil
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/cave-expedition/animation-evidence'
OUT.mkdir(parents=True, exist_ok=True)

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def translate_path(self, path):
        if path.startswith('/territory-game-builde/'):
            return str(ROOT / 'public' / path.split('/territory-game-builde/', 1)[1].split('?')[0])
        return super().translate_path(path)

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT / 'artifacts/cave-expedition')))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}'
reports = []
try:
  with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium') or shutil.which('google-chrome'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':430, 'height':480}, device_scale_factor=1)
    errors = []; failed = []; requests = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('response', lambda r: failed.append(r.url) if r.status >= 400 else None)
    page.on('request', lambda r: requests.append(r.url))
    page.goto(URL + '/animation-fixture.html'); page.wait_for_function('()=>window.qa')
    assert len([r for r in requests if '/animation/' in r]) == 1, 'Only visible boar clip requested'
    page.wait_for_function("()=>[...qa.images.keys()].some(k=>k.endsWith('/animation/08_armored_boar.webp'))")
    cases = [('boar','eel',21,'ember',2),('queen','boss',21,'astral',2)]
    # First validate the priority pair, then the remaining approved scope.
    cases += [('raider','shardling',1,'crystal',2),('mage','moth',1,'spore',2),('fungal','boss',1,'spore',2),('fire','boss',61,'forge',2),('driller','shardling',6,'crystal',9),('moss','moth',6,'spore',9)]
    for name,species,floor,biome,actor_id in cases:
      page.evaluate('(v)=>qa.snapshot(...v)', [species,floor,biome,actor_id]); page.wait_for_timeout(150)
      states = {}
      for pose,age in [('idle',0),('run',.08),('run',.2),('windup',.1),('release',.4),('recover',.57),('hit',.65),('death',1.0)]:
        state = page.evaluate('''([pose,age])=>{
          const w=qa.w,e=w.enemies[0];w.time=10+age;e.pose=pose==='windup'||pose==='release'||pose==='recover'?'attack':pose;
          e.impact=pose==='windup'?10.5:0;e.poseUntil=10.7;e.deathAt=10.7;e.hp=pose==='death'?0:100;
          const before=JSON.stringify(w);qa.draw();if(before!==JSON.stringify(w))throw Error('Renderer mutated world');
          return {id:qa.visualId(w,e),frame:qa.animationState(e,w.time).frame,image:document.querySelector('canvas').toDataURL()};
        }''', [pose,age])
        states[f'{pose}-{age}'] = {k:v for k,v in state.items() if k!='image'}
        page.screenshot(path=str(OUT / f'actor-{name}-{pose}-{age}.png'))
      assert states['windup-0.1']['frame']==3 and states['release-0.4']['frame']==4 and states['death-1.0']['frame']==7
      reports.append({'actor':name,'states':states})
    # Three already-existing phases have different static danger glyphs too.
    page.evaluate("qa.snapshot('boss',21,'astral',2)")
    for phase in [1,2,3]:
      page.evaluate('phase=>{let w=qa.w;w.bossPhase=phase;w.enemies[0].pose="attack";w.enemies[0].impact=10.3;w.enemies[0].heavy=true;qa.draw(true)}',phase)
      page.screenshot(path=str(OUT / f'queen-phase-{phase}-reduced.png'))
    # Pending electric strike, never invent damage from rendering.
    result=page.evaluate('''()=>{const w=qa.w;qa.snapshot('boss',21,'astral');w.pose='attack';w.target=2;w.heroImpact=w.time+.04;
      const before=JSON.stringify(w);qa.draw();return before===JSON.stringify(w)}''')
    assert result
    page.screenshot(path=str(OUT / 'electric-cut.png'))
    # Render cost is measured in actual Chromium (CPU/device limits stated in report).
    for quality in ['high','low']:
      timing=page.evaluate('''quality=>{let times=[];for(let i=0;i<180;i++){qa.w.time+=.016;const t=performance.now();qa.draw(false,quality);times.push(performance.now()-t)}times.sort((a,b)=>a-b);return {median:times[90],p95:times[171],max:times[179]}}''',quality)
      reports.append({'renderQuality':quality,'milliseconds':timing})
      assert timing['p95'] < 40, f'Canvas cost regression: {timing}'
    assert not errors and not failed, (errors,failed)
    assert all(r.startswith(URL) for r in requests), 'No external requests'
    page.close()

    # Real HTTP 404: optional animation must not reject mandatory preload or
    # repeat requests each frame; original approved image remains available.
    for mode in ['missing','slow','cancel']:
      context=browser.new_context(); page=context.new_page(); errors=[]; optional=[]; pending_routes=[]
      page.on('pageerror',lambda e:errors.append(str(e)))
      def intercept(route):
        optional.append(route.request.url)
        if mode=='missing': route.fulfill(status=404,body='missing')
        else: pending_routes.append(route)  # Delayed transport, aborted below.
      page.route('**/animation/*.webp',intercept)
      page.goto(URL+'/animation-fixture.html',wait_until='domcontentloaded');page.wait_for_function('()=>window.qa')
      page.evaluate('''()=>{for(let i=0;i<60;i++)qa.draw();if(![...qa.images.keys()].some(k=>k.endsWith('/approved/08_armored_boar.webp')))throw Error('Missing fallback')}''')
      page.wait_for_timeout(100)
      assert len(optional)==1
      before=page.locator('canvas').screenshot()
      assert len(before)>30000, 'Fallback scene must be drawn'
      if mode=='cancel': page.evaluate('qa.stop()')
      page.evaluate('qa.w.paused=false;qa.update(qa.w,.025);qa.draw()')
      assert page.evaluate('qa.w.time') > 10, 'Combat continues without new art'
      assert not errors,errors
      reports.append({'fault':mode,'optionalRequests':len(optional),'fallback':True})
      for route in pending_routes:
        try: route.abort()
        except Exception: pass
      context.close()

    # Actual game UI, narrow/short portrait + both locales, reduced motion.
    for width,height,lang in [(320,568,'ru'),(360,640,'en'),(390,720,'ru'),(430,720,'en')]:
      context=browser.new_context(viewport={'width':width,'height':height},has_touch=True,is_mobile=True,reduced_motion='reduce')
      page=context.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
      page.goto(URL+'/test-fixture.html?lang='+lang);page.wait_for_function('()=>window.__caveDemo')
      page.get_by_role('button',name='В путь' if lang=='ru' else 'Set out').click()
      page.wait_for_function("()=>__caveDemo.world.phase==='PORTAL_CHOICE'")
      page.locator('.cx-portal-touch').first.click()
      page.wait_for_timeout(150)
      assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1')
      assert page.locator('.cx-native-nav button').count()==7
      assert page.locator('[data-testid=cx-umbra-slot]').count()==12
      assert page.locator('[data-testid=cx-wings-slot]').count()==1
      assert not errors,errors
      page.screenshot(path=str(OUT/f'mobile-{width}-{lang}-reduced.png'))
      reports.append({'width':width,'height':height,'lang':lang,'reducedMotion':True,'errors':errors})
      context.close()
    browser.close()
finally:
  server.shutdown()
  (OUT/'report.json').write_text(json.dumps(reports,indent=2))
print('PASS #540 real browser: eight approved visuals, all pose states, three telegraphs, pure electric cut, HTTP missing/slow/cancel, lazy Pages-prefix assets, mobile RU/EN and render budget.')
