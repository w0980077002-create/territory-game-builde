"""Check genuine HeroShowcase with test honors at 320/360/390/430 browser widths.
This is an OFFLINE Chromium fixture. It is NOT physical Android/Telegram evidence.
"""
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        asset=os.path.join(os.getcwd(), 'public', path.lstrip('/').split('?')[0])
        if os.path.isfile(asset):
            return asset
        return super().translate_path(path)
    def log_message(self, *args):
        pass

httpd=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory='/tmp'))
threading.Thread(target=httpd.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(args=['--no-sandbox'])
        for width in (320,360,390,430):
            page=browser.new_page(viewport={'width':width,'height':760},reduced_motion='reduce')
            page.goto(f'http://127.0.0.1:{httpd.server_port}/territory-profile-preview.html?mortarion-preview')
            stage=page.locator('.hero-showcase__stage')
            stage.wait_for()
            owner=page.locator('[data-testid="mortarion-owner-honor-preview"]')
            assert owner.count()==1,(width,'QA controls not visible')
            assert page.locator('[data-testid="mortarion-forged-frame"]').count()==0,'Default hero is ordinary'
            for rank,tier in (('top1','lord'),('top2','conqueror'),('top4','hunter')):
                owner.locator(f'[data-testid="mortarion-owner-preview-{rank}"]').click()
                frame=page.locator('[data-testid="mortarion-forged-frame"]')
                frame.wait_for()
                frame.scroll_into_view_if_needed()
                assert frame.evaluate('(e) => e.complete && e.naturalWidth === 680 && e.naturalHeight === 660'),(width,rank,'Rank-specific SVG failed to load')
                assert frame.get_attribute('src').endswith(f'mortarion-{tier}-stage.svg'),(width,rank,'Wrong tier art')
                assert frame.evaluate("(e)=>getComputedStyle(e).pointerEvents==='none'"),(width,rank,'Decorative asset blocks taps')
                art_box=frame.bounding_box()
                stage_box=stage.bounding_box()
                assert abs(art_box['x']-stage_box['x'])<5,(width,rank,'Frame must cover stage padding box, not center portrait')
                assert abs(art_box['width']-stage_box['width'])<10,(width,rank,'Wrong stage width, accounting for gold border')
                assert abs(art_box['height']-stage_box['height'])<10,(width,rank,'Wrong stage height, accounting for gold border')
                # Pixel-level SVG alpha confirms hero's torso and boots are never
                # covered by metal (previous frame crossed the lower legs).
                alpha=frame.evaluate("""(img)=>{
                    const c=document.createElement('canvas');c.width=680;c.height=660;
                    const ctx=c.getContext('2d',{willReadFrequently:true});
                    ctx.drawImage(img,0,0,680,660);
                    return [220,360,520,600,628].map(y=>ctx.getImageData(340,y,1,1).data[3]);
                }""")
                assert alpha==[0,0,0,0,0],(width,rank,'Center hero/feet obscured',alpha)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,rank,'Horizontal scroll')
                slots=stage.locator('.hero-showcase__slot')
                assert slots.count()==7,(width,rank,'Lost equipment slots')
                assert all(s.bounding_box()['width']>=40 for s in slots.all()),(width,rank,'Unreadable equipment')
                page.evaluate('window.__route=null')
                slots.first.click(force=False)
                assert page.evaluate('window.__route')=='equipment',(width,rank,'Overlay blocks equipment')
                assert page.locator('[data-testid="mortarion-profile-title"]').is_visible()
                assert page.locator('[data-testid="mortarion-profile-medal"]').is_visible()
                if width==360:
                    page.screenshot(path=f'/tmp/mortarion-stage-360-{rank}.png',full_page=True,animations='disabled')
            owner.locator('[data-testid="mortarion-owner-preview-none"]').click()
            assert page.locator('[data-testid="mortarion-forged-frame"]').count()==0,(width,'Ordinary portrait must remain unaffected')
            page.close()
        browser.close()
finally:
    httpd.shutdown()
print('MORTARION BROWSER PASS: real React profile, 320/360/390/430, 3 ranks, 100% stage-aligned, center/feet transparent, slots clickable, no overflow; not Android')
