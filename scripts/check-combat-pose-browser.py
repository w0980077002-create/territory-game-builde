"""Actual FighterFigure, offline synthetic events. Not Telegram/network PvP."""
from pathlib import Path
from urllib.parse import urlparse
import mimetypes, shutil
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/tmp/territory-pose-verification'); OUT.mkdir(exist_ok=True)
ORIGIN='http://127.0.0.1:4173'
def serve(route):
    path=urlparse(route.request.url).path
    file=Path('/tmp/territory-combat-preview.html') if path=='/' else ROOT/'public'/path.lstrip('/')
    if file.is_file(): route.fulfill(body=file.read_bytes(),content_type='text/html' if path=='/' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
    else: route.fulfill(status=404,body='missing')
def set_visual(page,patch): page.evaluate('(p)=>window.__combat.set(p)',patch)
def event(key,tone='hit',attacker='Рагнар'):
    return {'key':key,'attacker':attacker,'target':'Противник' if attacker=='Рагнар' else 'Рагнар','tone':tone,'amount':17 if tone in ('hit','crit') else None}
def wait_pose(page,selector,pose,timeout=1600): page.wait_for_function('([s,p])=>document.querySelector(s)?.dataset.pose===p',arg=[selector,pose],timeout=timeout)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'),args=['--no-sandbox','--disable-breakpad','--disable-crash-reporter'])
    for width in (320,360,390,430):
        for lang in ('ru','en'):
            page=b.new_page(viewport={'width':width,'height':500},reduced_motion='reduce' if width==320 else 'no-preference')
            page.add_init_script("localStorage.setItem('territory-language', '"+lang+"')")
            errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
            page.route(ORIGIN+'/**',serve); page.route('https://**/*',lambda r:r.abort())
            page.goto(ORIGIN+'/'); page.wait_for_function('!!window.__combat')
            set_visual(page,{'appearance':'m1','enemy':'bandit'})
            page.wait_for_selector('#fixture-enemy img[src*=bandit]')
            h='#fixture-hero .fighter-figure__motion'; f='#fixture-enemy .fighter-figure__motion'
            assert page.locator(h).get_attribute('data-pose')=='idle'
            assert page.locator(f).get_attribute('data-pose')=='idle'
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            set_visual(page,{'strike':event(100)})
            assert page.locator(h).get_attribute('data-pose')=='idle', 'Windup must retain original idle'
            assert page.locator(f).get_attribute('data-pose')=='idle', 'Target cannot react before contact'
            wait_pose(page,h,'attack')
            assert page.locator(f).get_attribute('data-pose')=='idle'
            wait_pose(page,f,'hit')
            page.screenshot(path=str(OUT/f'contact-{width}-{lang}.png'))
            wait_pose(page,h,'idle')
            wait_pose(page,f,'idle')
            assert not errors,errors
            page.close()
    for speed in (1,2):
        page=b.new_page(viewport={'width':390,'height':760})
        page.route(ORIGIN+'/**',serve);page.route('https://**/*',lambda r:r.abort())
        page.goto(ORIGIN+'/');page.wait_for_function('!!window.__combat')
        set_visual(page,{'appearance':'m1','enemy':'bandit','speed':speed})
        page.wait_for_selector('#fixture-enemy img[src*=bandit]')
        h='#fixture-hero .fighter-figure__motion'; f='#fixture-enemy .fighter-figure__motion'
        for i,tone in enumerate(('block','dodge')):
            set_visual(page,{'strike':event(200+i,tone)})
            wait_pose(page,f,tone)
            wait_pose(page,f,'idle')
        set_visual(page,{'strike':event(211,'hit')})
        set_visual(page,{'strike':None})
        page.wait_for_timeout(400/speed)
        assert page.locator(f).get_attribute('data-pose')=='idle', 'Cancelled hit cannot fire later'
        set_visual(page,{'strike':event(211,'crit')})
        wait_pose(page,f,'hit')
        set_visual(page,{'appearance':'m1'})
        assert page.locator(f).get_attribute('data-pose')=='hit', 'Unrelated rerender cannot restart the sequence'
        set_visual(page,{'strike':None,'heroWon':True,'foeAlive':False})
        wait_pose(page,f,'death')
        assert 'fighter-victory' in page.locator(h).get_attribute('class')
        page.close()
    # Simulated visibility changes exercise cleanup; not a physical phone background test.
    page=b.new_page(viewport={'width':390,'height':760})
    page.add_init_script("Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2})")
    page.route(ORIGIN+'/**',serve);page.route('https://**/*',lambda r:r.abort())
    page.goto(ORIGIN+'/');page.wait_for_function('!!window.__combat')
    set_visual(page,{'appearance':'m1','enemy':'bandit'})
    page.wait_for_selector('#fixture-enemy img[src*=bandit]')
    set_visual(page,{'strike':event(300)})
    wait_pose(page,'#fixture-hero .fighter-figure__motion','attack')
    assert page.locator('#fixture-hero .fighter-figure').get_attribute('data-quality')=='low'
    assert page.locator('#fixture-hero .fighter-figure__afterimage').evaluate("el=>getComputedStyle(el).display=='none'")
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(900)
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
    assert page.locator('#fixture-hero .fighter-figure__motion').get_attribute('data-pose')=='idle'
    set_visual(page,{'strike':None});page.close()
    # Existing PvE controls trigger playRound; no synthetic StrikeEvent here.
    page=b.new_page(viewport={'width':390,'height':760})
    page.route(ORIGIN+'/**',serve);page.route('https://**/*',lambda r:r.abort())
    page.goto(ORIGIN+'/?scene=pve&appearance=m1&enemy=bandit')
    page.wait_for_selector('img[src*=male_rogue]');page.wait_for_selector('img[src*=bandit]')
    assert page.locator('.fighter-figure__motion[data-pose=attack]').count()==0
    page.get_by_role('button',name='Защита: Голова',exact=True).click()
    page.get_by_role('button',name='Защита: Грудь',exact=True).click()
    page.get_by_role('button',name='Удар: Живот',exact=True).click()
    page.get_by_role('button',name='УДАР',exact=True).click()
    page.wait_for_selector('.fighter-figure__motion[data-pose=attack]',timeout=3000)
    page.screenshot(path=str(OUT/'real-pve-attack-390.png'))
    page.close()
    b.close()
print('Pose scene PASS: original m1/bandit, windup/contact/recovery, block/dodge, cancellation, outcomes, x1/x2, 320/360/390/430 RU/EN, reduced motion; synthetic offline events.')
