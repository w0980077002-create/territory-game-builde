"""Real Canvas + HTML acceptance and identical-state before/after capture.
Build current --test fixture first. Optional CAVE_BASELINE points at a fixture built
from main BEFORE changes, not an illustration. Offline only; no player accounts.
"""
import json, os, shutil, threading
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/cave-expedition/crystal-evidence'
OUT.mkdir(parents=True, exist_ok=True)
BASELINE = os.getenv('CAVE_BASELINE')
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT / 'artifacts/cave-expedition')))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}'

def fixture(page, before=False, lang='ru'):
    if before:
        page.route(URL+'/**', lambda route: route.fulfill(body=Path(BASELINE).read_bytes(), content_type='text/html'))
    page.goto(URL+'/test-fixture.html?lang='+lang)
    page.wait_for_function('()=>window.__caveDemo')

def fight(page, lang='ru'):
    page.get_by_role('button', name='Set out' if lang=='en' else 'В путь').tap()
    page.evaluate('__caveDemo.step(3)')
    page.locator('.cx-portals button').nth(2).tap()
    page.evaluate("()=>{for(let i=0;i<500&&__caveDemo.world.phase!=='FIGHT';i++)__caveDemo.step(.1)}")
    page.wait_for_function("()=>__caveDemo.world.phase==='FIGHT'")
    page.wait_for_timeout(150)

def controls(page):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1')
    assert page.get_by_test_id('cx-umbra-slot').count()==12
    assert page.get_by_test_id('cx-wings-slot').count()==1
    for selector in ['.cx-controls', '.cx-native-nav', '.cx-header']:
        box=page.locator(selector).bounding_box()
        assert box and box['x']>=0 and box['y']>=0 and box['x']+box['width']<=page.viewport_size['width']+1
        assert box['y']+box['height']<=page.viewport_size['height']+1

def freeze(page, state):
    # Freeze only the fixture's simulation step for the last real Canvas frame.
    # Publish the exact same world via the existing Auto button's refresh handler.
    page.evaluate('(w)=>{Object.assign(__caveDemo.world,w,{speed:0});window.requestAnimationFrame=()=>0}', state)
    page.wait_for_timeout(150)
    page.evaluate('(speed)=>{__caveDemo.world.speed=speed}', state['speed'])
    page.get_by_role('button',name='Авто навыков',exact=True).evaluate('(e)=>{e.click();e.click()}')
    page.wait_for_timeout(150)

reports=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium'), args=['--no-sandbox'])
    for width,height in [(320,568),(360,640),(390,844),(430,740)]:
        state=None
        for before in ([True,False] if BASELINE else [False]):
            page=browser.new_page(viewport={'width':width,'height':height},is_mobile=True,has_touch=True,device_scale_factor=1)
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            fixture(page,before);fight(page)
            if state is None:
                state=page.evaluate('JSON.parse(JSON.stringify(__caveDemo.world))')
                state.update(floor=36,unlockedFloor=36,time=12,phaseAt=11.9,shake=0)
            freeze(page,state);controls(page)
            label='before' if before else 'after'
            page.screenshot(path=str(OUT/f'{label}-{width}.png'))
            assert not errors, errors
            page.close()
        reports.append({'width':width,'height':height,'identical_state_before_after':bool(BASELINE),'slots':13,'overflow':False})
    # Real pause freezes pixels, camera and simulation; visibility resumes explicitly.
    for lang in ['ru','en']:
        page=browser.new_page(viewport={'width':360,'height':640},is_mobile=True,has_touch=True)
        fixture(page,lang=lang);fight(page,lang);controls(page)
        page.get_by_role('button',name='Pause' if lang=='en' else 'Пауза',exact=True).tap()
        page.wait_for_timeout(150)
        frozen=page.evaluate('({pixels:document.querySelector("canvas").toDataURL(),time:__caveDemo.world.time,camera:__caveDemo.world.cameraX})')
        page.wait_for_timeout(250)
        assert page.evaluate('({pixels:document.querySelector("canvas").toDataURL(),time:__caveDemo.world.time,camera:__caveDemo.world.cameraX})')==frozen
        page.get_by_role('button',name='Continue' if lang=='en' else 'Продолжить путь').tap()
        page.wait_for_timeout(150);assert page.evaluate('__caveDemo.world.time')>frozen['time']
        page.emulate_media(reduced_motion='reduce')
        page.evaluate("document.documentElement.style.setProperty('--territory-top-inset','96px');document.documentElement.style.setProperty('--territory-bottom-inset','28px')")
        page.wait_for_timeout(150);controls(page)
        assert page.locator('.cx-header').bounding_box()['y']>=96
        page.screenshot(path=str(OUT/f'insets-reduced-{lang}.png'));page.close()
    # All four Crystal rooms and the boss use the real unchanged floor engine.
    page=browser.new_page(viewport={'width':360,'height':640},is_mobile=True,has_touch=True)
    fixture(page);page.get_by_role('button',name='В путь').tap()
    page.evaluate('__caveDemo.world.auto=true;__caveDemo.world.autoPotions=true')
    choices=0;boss=False;rooms=set()
    for _ in range(900):
        w=page.evaluate('({phase:__caveDemo.world.phase,room:__caveDemo.world.room,kills:__caveDemo.world.kills,biome:__caveDemo.world.biome})')
        if w['phase']=='PORTAL_CHOICE':
            page.locator('.cx-portals button').nth(2).tap();choices+=1
        if w['phase']=='RUN_RIGHT' and w['room'] not in rooms:
            rooms.add(w['room']);page.screenshot(path=str(OUT/f"moving-room-{w['room']+1}.png"))
        if w['phase']=='BOSS' and not boss:
            boss=True;page.wait_for_timeout(150);page.screenshot(path=str(OUT/'crystal-boss.png'))
        if w['phase'] in ['VICTORY','DEFEAT']: break
        page.evaluate('__caveDemo.step(.75)');page.wait_for_timeout(35)
    assert w['phase']=='VICTORY' and choices==4 and boss and w['kills']==45,w
    assert page.evaluate('__caveDemo.world.stars.join()')=='3,3,3,3'
    reports.append({'four_crystal_rooms':'PASS','boss':'PASS','kills':w['kills']})
    page.close()
    # Missing new decoration must fall back to the existing playable environment.
    import base64
    bad='data:image/webp;base64,'+base64.b64encode((ROOT/'public/assets/territory/cave-expedition/crystal-rift-depth.webp').read_bytes()).decode()
    page=browser.new_page(viewport={'width':360,'height':640},is_mobile=True,has_touch=True)
    page.add_init_script("""const NativeImage=window.Image,source=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
      window.Image=function(...args){const img=new NativeImage(...args);Object.defineProperty(img,'src',{
      set(value){if(value==="""+json.dumps(bad)+"""){setTimeout(()=>img.onerror?.(new Event('error')),0)}else source.set.call(img,value)},get(){return source.get.call(img)}});return img};""")
    fixture(page);fight(page);controls(page);page.screenshot(path=str(OUT/'asset-fallback.png'));page.close()
    # A low-end device keeps the same geometry and readable combat strip.
    context=browser.new_context(viewport={'width':320,'height':568},is_mobile=True,has_touch=True,reduced_motion='reduce')
    context.add_init_script("Object.defineProperty(navigator,'hardwareConcurrency',{value:2});Object.defineProperty(navigator,'deviceMemory',{value:2})")
    page=context.new_page();fixture(page);fight(page);controls(page);page.screenshot(path=str(OUT/'low-detail-320.png'));context.close()
    # Matched throttled diagnostic, both running the real game loop and Canvas.
    for before in ([True,False] if BASELINE else [False]):
        context=browser.new_context(viewport={'width':360,'height':640},is_mobile=True,has_touch=True,device_scale_factor=2)
        page=context.new_page();fixture(page,before);fight(page)
        cdp=context.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',{'rate':4});cdp.send('Performance.enable')
        samples=page.evaluate('''()=>new Promise(resolve=>{const values=[];let last=performance.now(),start=last;function frame(now){values.push(now-last);last=now;if(now-start<6000)requestAnimationFrame(frame);else resolve(values)}requestAnimationFrame(frame)})''')
        samples=sorted(samples[2:]);metrics={m['name']:m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
        report={'label':'before' if before else 'after','cpu_throttle':4,'dpr':2,'frames':len(samples),'median_ms':round(samples[len(samples)//2],2),'p95_ms':round(samples[int(len(samples)*.95)],2),'heap_bytes':metrics.get('JSHeapUsedSize'),'real_android':False}
        assert len(samples)>100,report
        reports.append(report);print(report,flush=True);context.close()
    browser.close()
server.shutdown()
(OUT/'report.json').write_text(json.dumps(reports,indent=2))
print('PASS Crystal: 4 portrait sizes, 13 slots, RU/EN, exact pixel pause, insets, reduced motion, matched 4x CPU diagnostic',flush=True)
