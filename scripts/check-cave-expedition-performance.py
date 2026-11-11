"""Chromium diagnostic under 4x CPU throttling; not a real Android benchmark."""
import json, os, shutil, threading
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT/'artifacts/cave-expedition')))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium'),args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':360,'height':640},is_mobile=True,has_touch=True)
    page=context.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/test-fixture.html')
    page.get_by_role('button',name='Играть DEMO').tap();page.get_by_role('button',name='Авто навыков').tap()
    client=context.new_cdp_session(page);client.send('Emulation.setCPUThrottlingRate',{'rate':4});client.send('Performance.enable')
    frames=page.evaluate('''()=>new Promise(resolve=>{const frames=[];let last=performance.now(),start=last;function frame(now){frames.push(now-last);last=now;if(now-start<6000)requestAnimationFrame(frame);else resolve(frames)}requestAnimationFrame(frame)})''')
    frames=sorted(frames[2:]);metrics={m['name']:m['value'] for m in client.send('Performance.getMetrics')['metrics']}
    result={'viewport':'360x640','cpu_throttle':4,'frames':len(frames),'median_ms':round(frames[len(frames)//2],2),'p95_ms':round(frames[int(len(frames)*.95)],2),'js_heap_used_bytes':metrics.get('JSHeapUsedSize'),'dom':client.send('Memory.getDOMCounters'),'real_android':False}
    assert len(frames)>70,result
    # Long touch applies one action, not an uncontrolled repeat.
    button=page.get_by_role('button',name='Раскол',exact=True)
    before=page.evaluate('__caveDemo.world.casts')
    if button.is_enabled():
        box=button.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.wait_for_timeout(600);page.mouse.up()
        assert page.evaluate('__caveDemo.world.casts')-before<=1
    context.close();browser.close()
server.shutdown()
out=ROOT/'artifacts/cave-expedition/evidence/performance-report.json';out.write_text(json.dumps(result,indent=2))
print(json.dumps(result))
