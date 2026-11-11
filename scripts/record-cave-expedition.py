"""Optional real-time evidence. No engine stepping or artificial victories."""
import os
import shutil
import threading
import time
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/cave-expedition/evidence'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT/'artifacts/cave-expedition')))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':720},device_scale_factor=1,is_mobile=True,has_touch=True,record_video_dir=str(OUT),record_video_size={'width':390,'height':720})
    page=context.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/territory-cave-demo.html')
    page.get_by_role('button',name='Играть DEMO').tap();page.get_by_role('button',name='Авто').tap()
    began=time.monotonic();last='';rooms=0
    while time.monotonic()-began<240:
        phase=page.locator('.cx-stage').get_attribute('data-phase')
        if phase!=last:
            print(f'{time.monotonic()-began:.1f}s {phase}',flush=True);last=phase
        if phase=='PORTAL_CHOICE':
            page.wait_for_timeout(1600)
            page.locator('.cx-portals button').nth(rooms%2).tap();rooms+=1
        if phase in ['VICTORY','DEFEAT']:
            assert phase=='VICTORY', 'Recorded demo must actually win'
            page.wait_for_timeout(2500);break
        page.wait_for_timeout(200)
    else:raise AssertionError('Real time run did not finish')
    video=page.video;context.close();video.save_as(str(OUT/'real-time-run-390.webm'));browser.close()
server.shutdown()
print('REAL-TIME full run captured',flush=True)
