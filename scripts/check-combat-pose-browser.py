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
            if width==320:
                assert float(page.locator('#fixture-enemy .fighter-impact__label').evaluate('el=>getComputedStyle(el).opacity')) < .01, 'Reduced-motion label cannot precede contact'
            wait_pose(page,h,'attack')
            assert page.locator(f).get_attribute('data-pose')=='idle'
            wait_pose(page,f,'hit')
            if width==320:
                page.wait_for_function("Number(getComputedStyle(document.querySelector('#fixture-enemy .fighter-impact__label')).opacity)>.9",timeout=300)
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
        # A busy mobile runner may legitimately finish the old hit while
        # updating appearance. It must NEVER restart that hit at windup.
        assert page.locator(f).get_attribute('data-phase')!='windup', 'Unrelated rerender must never replay an old strike'
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
    # The three approved non-Viking hero portraits now have actual independent
    # SVG cutout joints. Validate against existing queued confirmed events.
    for appearance, portrait in (('m1','male_rogue'), ('f1','female_warrior'), ('f2','female_archer')):
        page=b.new_page(viewport={'width':390,'height':760})
        page.route(ORIGIN+'/**',serve);page.route('https://**/*',lambda r:r.abort())
        page.goto(ORIGIN+'/');page.wait_for_function('!!window.__combat')
        set_visual(page,{'appearance':appearance,'strike':None})
        hero=page.locator('#fixture-hero svg[data-original-hero="' + portrait + '"]')
        hero.wait_for(timeout=4000)
        assert hero.locator('[data-articulated-part]').count()==5, (appearance,'missing real joint layers')
        assert hero.get_attribute('data-motion')=='idle'
        assert hero.locator('[data-articulated-part="head"]').evaluate(
            "el=>getComputedStyle(el).animationName!='none'"), (appearance,'no independent head motion')
        set_visual(page,{'strike':event(810,'crit')})
        page.wait_for_function("document.querySelector('#fixture-hero svg[data-original-hero]')?.dataset.motion==='attack'")
        assert hero.locator('[data-articulated-part="weapon"]').evaluate(
            "el=>getComputedStyle(el).animationName!='none'"), (appearance,'weapon did not strike')
        wait_pose(page,'#fixture-hero .fighter-figure__motion','attack')
        set_visual(page,{'strike':None})
        page.wait_for_function("document.querySelector('#fixture-hero svg[data-original-hero]')?.dataset.motion==='idle'")
        for tone in ('block','dodge','hit'):
            set_visual(page,{'strike':event(830+len(tone),tone,attacker='Противник')})
            page.wait_for_function("kind=>document.querySelector('#fixture-hero svg[data-original-hero]')?.dataset.motion===kind",
                                   arg=tone, timeout=2000)
            set_visual(page,{'strike':None})
        page.emulate_media(reduced_motion='reduce')
        assert hero.evaluate("el=>getComputedStyle(el).display==='none'"), (appearance,'reduced motion should use original pose')
        assert page.locator('#fixture-hero .original-hero-approved-pose').evaluate(
            "el=>getComputedStyle(el).opacity==='1'"), (appearance,'original reduced-motion art hidden')
        page.close()
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
    # Verify actual playRound outcomes with the existing original follower art.
    # Never inject a synthetic StrikeEvent or a fabricated heal into the UI.
    for follower_id in ('follower_3', 'follower_6'):
        page=b.new_page(viewport={'width':390,'height':760})
        page.route(ORIGIN+'/**',serve);page.route('https://**/*',lambda r:r.abort())
        page.goto(ORIGIN+'/?scene=pve&appearance=m1&enemy=bandit&follower='+follower_id)
        page.wait_for_selector('[data-testid="pve-visible-follower"] img')
        assert page.locator('[data-testid="pve-companion-heal"]').count()==0, 'No cosmetic heal before a resolved round'
        assert page.locator('[data-testid="pve-companion-strike-fx"]').count()==0, 'No projectile before a resolved companion hit'
        # A mobile frame can miss a 900 ms transient while Chromium is saving
        # a screenshot. Capture actual DOM appearances before submitting the
        # real round; never inject a fake heal or companion hit.
        page.evaluate("""() => {
          window.__companionSeen={strikes:[],heals:[]};
          const scan=()=>{
            document.querySelectorAll('[data-testid="pve-companion-strike-fx"]').forEach(el=>{
              const kind=el.getAttribute('data-kind');
              if(kind&&!window.__companionSeen.strikes.includes(kind))window.__companionSeen.strikes.push(kind);
            });
            document.querySelectorAll('[data-testid="pve-companion-heal"]').forEach(el=>{
              const label=el.textContent?.trim();
              if(label&&!window.__companionSeen.heals.includes(label))window.__companionSeen.heals.push(label);
            });
          };
          new MutationObserver(scan).observe(document.body,{childList:true,subtree:true,characterData:true});
          scan();
        }""")
        page.get_by_role('button',name='Защита: Голова',exact=True).click()
        page.get_by_role('button',name='Защита: Грудь',exact=True).click()
        page.get_by_role('button',name='Удар: Живот',exact=True).click()
        page.get_by_role('button',name='УДАР',exact=True).click()
        page.wait_for_selector('[data-testid="pve-companion-action"][data-action="attack"]',timeout=7500)
        fx=page.locator('[data-testid="pve-companion-strike-fx"]')
        fx.wait_for(timeout=1200)
        assert fx.get_attribute('data-kind')==('leaf' if follower_id=='follower_3' else 'crystal'), 'Companion must keep its own real strike identity'
        if follower_id=='follower_6':
            cow=page.locator('[data-original-cow="battle_cow"]')
            assert cow.count()==1, 'Approved Cow must be articulated, never replaced'
            cow.wait_for(state='visible')
            parts=cow.locator('[data-cow-part]')
            assert parts.count()==5, 'Five separate cow source-art parts must move'
            assert cow.get_attribute('data-motion')=='attack', 'Only a confirmed hit moves the Cow hand'
            assert cow.locator('image').evaluate_all('nodes=>new Set(nodes.map(n=>n.getAttribute("href"))).size')==1, 'Use exact one original art source'
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Cow must not overflow 390px'
            # Temporary visual QA evidence, using real approved artwork.
            # This line is removed before merging after image inspection.
            import base64
            print('COW_QA_PNG_BASE64='+base64.b64encode(cow.screenshot()).decode(), flush=True)
        page.screenshot(path=str(OUT/f'companion-real-attack-{follower_id}.png'))
        page.wait_for_function("window.__companionSeen.heals.length > 0",timeout=7500)
        observed=page.evaluate('window.__companionSeen')
        assert observed['strikes']==[('leaf' if follower_id=='follower_3' else 'crystal')], (follower_id,observed)
        assert any('HP' in label for label in observed['heals']), ('Confirmed companion heal missing HP',follower_id,observed)
        # The actual heal is verified by MutationObserver even when its
        # transient UI expires before slow headless screenshot capture.
        if page.locator('[data-testid="pve-companion-heal"]').count():
            page.screenshot(path=str(OUT/f'companion-real-heal-{follower_id}.png'))
        page.close()
    b.close()
print('Pose scene PASS: original m1/bandit, windup/contact/recovery, block/dodge, cancellation, outcomes, x1/x2, 320/360/390/430 RU/EN, reduced motion; synthetic offline events.')
