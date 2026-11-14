"""Offline real React profile, never a production save or Android/WebView test.
MORTARION_EVIDENCE names the directory containing actual browser screenshots.
"""
import os, threading, json, shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        asset=os.path.join(os.getcwd(),'public',path.lstrip('/').split('?')[0])
        return asset if os.path.isfile(asset) else super().translate_path(path)
    def log_message(self,*args): pass

out=os.environ.get('MORTARION_EVIDENCE','/tmp/mortarion-after')
os.makedirs(out,exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory='/tmp'))
threading.Thread(target=server.serve_forever,daemon=True).start()
results=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox'])
        for width in (320,360,390,430):
            page=browser.new_page(viewport={'width':width,'height':760},reduced_motion='reduce')
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            # The fixture must not make network requests to real services.
            page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:') else route.abort())
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?mortarion-preview')
            stage=page.locator('.hero-showcase__stage'); stage.wait_for()
            page.wait_for_function("document.querySelector('.hero-showcase__hero-art').complete")
            baseline=page.evaluate('window.__fixtureState()')
            def geometry():
                return stage.locator('.hero-showcase__slot,.hero-showcase__hero-art,.hero-showcase__stage-level').evaluate_all('(els)=>els.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})')
            stage.scroll_into_view_if_needed()
            initial=geometry()
            values=page.locator('.hero-showcase__stats,.hero-showcase__progress,.hero-showcase__resources').all_text_contents()
            stage.screenshot(path=f'{out}/{width}-ordinary.png')
            for rank,tier in (('top1','lord'),('top2','conqueror'),('top4','hunter'),('top1','lord'),('none',None)):
                page.locator(f'[data-testid="mortarion-owner-preview-{rank}"]').click()
                stage.scroll_into_view_if_needed()
                frame=page.locator('[data-testid="mortarion-forged-frame"]')
                if tier:
                    frame.wait_for()
                    page.wait_for_function("document.querySelector('[data-testid=mortarion-forged-frame]').complete && document.querySelector('[data-testid=mortarion-forged-frame]').naturalWidth>0")
                    assert frame.get_attribute('src').endswith('mortarion-lord-approved.avif' if rank=='top1' else f'mortarion-{tier}-stage.svg')
                else:
                    assert frame.count()==0
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,rank,'Overflow')
                # Geometry relative to stage is invariant even as the header title appears.
                current=geometry()
                assert all(abs(a-b)<.1 for before,after in zip(initial,current) for a,b in zip(before[2:],after[2:])),(width,rank,'Resized hero/slots')
                for first,item in zip(initial,current):
                    assert abs((first[0]-initial[0][0])-(item[0]-current[0][0]))<.1
                    assert abs((first[1]-initial[0][1])-(item[1]-current[0][1]))<.1
                slots=stage.locator('.hero-showcase__slot')
                assert slots.count()==7
                for slot in slots.all():
                    page.evaluate('window.__route=null')
                    slot.click()
                    assert page.evaluate('window.__route')=='equipment',(width,rank,'Blocked slot')
                assert page.evaluate('window.__fixtureState()')==baseline,(width,rank,'Changed saved state')
                assert page.locator('.hero-showcase__stats,.hero-showcase__progress,.hero-showcase__resources').all_text_contents()==values
                if rank=='top1':
                    composition=page.locator('.mortarion-crown')
                    assert composition.evaluate("e=>getComputedStyle(e).pointerEvents==='none'")
                    assert composition.evaluate("e=>e.getAnimations({subtree:true}).length===0"),'Reduced motion still animating'
                    # No jewel can be clipped by its own composition viewport or the level badge.
                    level=stage.locator('.hero-showcase__stage-level').bounding_box()
                    foot=composition.locator('.mortarion-crown__foot').bounding_box()
                    stage.screenshot(path=f'{out}/{width}-top1.png')
                    assert foot['y']+foot['height']*(493-400)/112 <= level['y']+1,(width,'Ruby under level')
                stage.screenshot(path=f'{out}/{width}-{rank}.png')
            assert not errors,errors
            results.append({'width':width,'all_seven_slots':True,'state_unchanged':True,'geometry_unchanged':True,'overflow':False})
            page.close()
        equipped=browser.new_page(viewport={'width':360,'height':760},reduced_motion='reduce')
        equipped.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?mortarion-preview&gear=1')
        equipped.locator('.hero-showcase__stage').wait_for()
        saved=equipped.evaluate('window.__fixtureState()')
        assert equipped.locator('.hero-showcase__slot--equipped').count()==7
        for rank in ('top1','top2','top4','none'):
            equipped.locator(f'[data-testid="mortarion-owner-preview-{rank}"]').click()
            assert equipped.evaluate('window.__fixtureState()')==saved,'Equipped gear changed'
            assert equipped.locator('.hero-showcase__item-level').all_text_contents()==['41']*7
        equipped.close()
        # Unsupported AVIF keeps the SAME approved art via lossless WebP.
        legacy=browser.new_page(viewport={'width':360,'height':760},reduced_motion='reduce')
        legacy.route('**/*.avif',lambda route:route.abort())
        legacy.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?mortarion-preview')
        legacy.locator('[data-testid="mortarion-owner-preview-top1"]').click()
        legacy.wait_for_function("""()=>{const e=document.querySelector('[data-testid=mortarion-forged-frame]');return e?.src.endsWith('.webp')&&e.complete&&e.naturalWidth===512}""")
        assert legacy.locator('.mortarion-crown image').evaluate_all("els=>els.every(e=>e.getAttribute('href').endsWith('.webp'))")
        legacy.locator('.hero-showcase__stage').screenshot(path=f'{out}/360-no-avif.png')
        legacy.close()
        # Timeline evidence, real animations enabled. Returning to TOP1 remounts awakening.
        page=browser.new_page(viewport={'width':390,'height':760},reduced_motion='no-preference')
        page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?mortarion-preview')
        page.locator('[data-testid="mortarion-owner-preview-top1"]').click()
        crown=page.locator('.mortarion-crown'); crown.scroll_into_view_if_needed()
        for ms in (0,250,550,900,5000,16000):
            crown.evaluate('(e,t)=>e.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=t})',ms)
            page.locator('.hero-showcase__stage').screenshot(path=f'{out}/390-motion-{ms}.png')
        assert crown.evaluate("e=>e.getAnimations({subtree:true}).some(a=>a.animationName==='mortarionAwaken')")
        page.locator('[data-testid="mortarion-owner-preview-top2"]').click()
        assert crown.count()==0,'TOP1 effects leaked into another rank'
        page.locator('[data-testid="mortarion-owner-preview-top1"]').click()
        page.locator('.mortarion-crown--ready').wait_for()
        assert crown.evaluate("e=>e.getAnimations().some(a=>a.currentTime<850)"),'Awakening did not restart'
        page.close();browser.close()
finally:
    server.shutdown()
with open(f'{out}/results.json','w') as f: json.dump(results,f,indent=2)
print('MORTARION BROWSER PASS: 320/360/390/430, all ranks, 7 taps per rank, unchanged geometry/state/XP/stats/resources, reduced motion, AVIF fallback, awakening restart. Offline Chromium only.')
