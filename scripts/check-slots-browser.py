"""Production server-slot component/API with offline fixtures; no live accounts."""
from pathlib import Path
from urllib.parse import urlparse
import json
import mimetypes
import shutil
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/tmp/slots-screenshots');OUT.mkdir(exist_ok=True)
ORIGIN='http://127.0.0.1:4173'
def serve(route):
    path=urlparse(route.request.url).path
    f=Path('/tmp/slots-preview.html') if path=='/' else ROOT/'public'/path.lstrip('/')
    assert f.is_file(),f'Missing fixture asset: {f}'
    route.fulfill(body=f.read_bytes(),content_type='text/html' if path=='/' else mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
def load(browser,w=390,h=844):
    page=browser.new_page(viewport={'width':w,'height':h},reduced_motion='reduce')
    page.route(ORIGIN+'/**',serve);page.route('https://**/*',lambda r:r.abort())
    page.goto(ORIGIN+'/')
    page.wait_for_selector('[data-testid=viking-slots-server]')
    page.get_by_role('button',name='КРУТИТЬ',exact=True).wait_for()
    return page
def skip_reel_animation(page):
    # The server confirms a winning decision before the 2.4s reel animation
    # finishes. Assert SKIP is still in the DOM while reels are moving, and
    # invoke it synchronously to avoid Playwright actionability waiting until
    # the animation completes and its button legitimately disappears.
    page.wait_for_function('document.querySelector(".vslot-reel-track--rolling") !== null',timeout=5000)
    page.evaluate('''() => {
      const button = [...document.querySelectorAll('button')]
        .find(item => item.textContent?.trim() === 'ПРОПУСТИТЬ');
      if (!button || button.disabled) throw new Error('SKIP must be available during the reel animation');
      button.click();
    }''')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
    errors=[];viewports=[]
    for w,h in [(320,568),(360,700),(390,844),(430,740)]:
        page=load(browser,w,h);page.on('pageerror',lambda e:errors.append(str(e)))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'horizontal overflow'
        assert page.locator('.vslot-reel-window').count()==5
        assert page.locator('.vslot-symbol').count()==15
        assert '500' in page.locator('.vslot-stats').inner_text()
        page.get_by_role('button',name='КРУТИТЬ',exact=True).scroll_into_view_if_needed()
        box=page.get_by_role('button',name='КРУТИТЬ',exact=True).bounding_box()
        assert box['x']>=0 and box['x']+box['width']<=w
        page.screenshot(path=str(OUT/f'slots-{w}x{h}.png'),full_page=True)
        viewports.append({'width':w,'height':h,'horizontal_overflow':False})
        page.close()
    page=load(browser)
    # Synchronous ref lock must guard two events before React re-renders.
    page.get_by_role('button',name='КРУТИТЬ',exact=True).evaluate('(b)=>{b.click();b.click()}')
    page.wait_for_function('window.__slotCalls.length===1')
    skip_reel_animation(page)
    page.get_by_role('button',name='ЗАБРАТЬ 32',exact=True).click()
    page.wait_for_function('window.__slotClaims===32')
    assert page.evaluate('window.__slotCalls.filter(x=>x.p_action==="collect").length')==1
    assert page.evaluate('localStorage.getItem("territory_slots_operation_v1_review")') is None
    # Timeout after server commit must retain the exact operation across remount.
    page.evaluate('window.__slotTimeout=true')
    page.get_by_role('button',name='КРУТИТЬ',exact=True).click()
    page.get_by_role('button',name='БЕЗОПАСНО ПОВТОРИТЬ ДЕЙСТВИЕ',exact=True).wait_for()
    saved=page.evaluate('JSON.parse(localStorage.getItem("territory_slots_operation_v1_review"))')
    page.locator('#fixture-remount').evaluate('(b)=>b.click()')
    retry=page.get_by_role('button',name='БЕЗОПАСНО ПОВТОРИТЬ ДЕЙСТВИЕ',exact=True);retry.wait_for();retry.click()
    page.wait_for_function('localStorage.getItem("territory_slots_operation_v1_review")===null')
    assert page.evaluate('window.__slotCalls.at(-1).p_operation')==saved['id']
    assert page.evaluate('window.__slotCalls.at(-1).p_expected')==saved['expected']
    # Risk uses the real request API and a server response, no client RNG.
    page.get_by_role('button',name='РИСК ×2',exact=True).click()
    page.get_by_role('dialog',name='Бонусная игра').wait_for()
    assert page.locator('.vslot-adventure-tile').count()==4
    page.get_by_role('button',name='Выбрать 1',exact=True).click()
    page.get_by_role('button',name='ЗАБРАТЬ 64',exact=True).wait_for()
    page.get_by_role('button',name='ЗАБРАТЬ 64',exact=True).click()
    # Bonus board retains approved immersive art; reopening restores server phase.
    page.evaluate('window.__slotNextState={phase:"bonus",pending:10,opened:[],picksLeft:5,shields:0,revealed:{}}')
    page.get_by_role('button',name='КРУТИТЬ',exact=True).click()
    skip_reel_animation(page)
    page.get_by_role('dialog',name='Бонусная игра').wait_for()
    assert page.locator('.vslot-adventure-tile').count()==5
    page.get_by_role('button',name='Выбрать 1',exact=True).click()
    page.wait_for_function('document.querySelectorAll(".vslot-adventure-tile:disabled").length===1')
    page.screenshot(path=str(OUT/'bonus-390.png'),full_page=True)
    page.locator('#fixture-remount').evaluate('(b)=>b.click()')
    page.get_by_role('dialog',name='Бонусная игра').wait_for()
    assert page.locator('.vslot-adventure-tile:disabled').count()==1
    # A blocked durable write must never send a gameplay request.
    page=load(browser)
    # Return a non-callable value: Playwright invokes functions returned by
    # evaluate(), which would otherwise trigger our fake storage error here.
    page.evaluate('() => { Storage.prototype.setItem=function(){throw new Error("blocked")}; }')
    page.get_by_role('button',name='КРУТИТЬ',exact=True).click()
    page.get_by_role('alert').wait_for()
    assert page.evaluate('window.__slotCalls.length')==0
    assert not errors,errors
    browser.close()
(OUT/'verification.json').write_text(json.dumps({'fixture':'production live-slot component/API, mocked transport; SQL separately tested in PGlite','viewports':viewports,'checks':['5x3 board','large ticket wallet','double click guard','gold claim','committed timeout/remount/replay','risk','bonus recovery','blocked storage prevents RPC'],'physical_telegram_device':False},ensure_ascii=False,indent=2))
print('Slots browser PASS: four mobile viewports, real component/API, 500K tickets, double-click lock, gold collection, timeout/restart stable UUID, risk, bonus restore and storage failure. Offline transport; not physical Telegram verification.')
