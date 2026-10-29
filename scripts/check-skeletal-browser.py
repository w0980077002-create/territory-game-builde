"""Browser verification of production fighters/PvP scene/PvE with offline state.

Run: node scripts/build-combat-preview.mjs && python scripts/check-skeletal-browser.py
This is Chromium mobile emulation, not Telegram authentication or network PvP.
"""
from pathlib import Path
from urllib.parse import urlparse
import json
import math
import time
import mimetypes
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/territory-combat-verification')
OUT.mkdir(exist_ok=True)
ORIGIN = 'http://127.0.0.1:4173'
report = {'environment': 'Chromium headless, actual production React components and CSS; offline in-memory game state',
          'limitations': ['No Telegram authorization', 'No real network PvP', 'No physical Android/iPhone FPS claim'],
          'viewports': [], 'attacks': {}, 'errors': [], 'missing_assets': [], 'max_support_drift_px': 0, 'max_contact_gap_px': 0, 'contact_measurements': []}


def serve(route):
    path = urlparse(route.request.url).path
    file = Path('/tmp/territory-combat-preview.html') if path == '/' else ROOT / 'public' / path.lstrip('/')
    if not file.is_file():
        report['missing_assets'].append(str(file))
        route.fulfill(status=404, body='missing fixture asset')
        return
    route.fulfill(body=file.read_bytes(), content_type='text/html' if path == '/' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream')


def load(browser, width=390, scene='figure', reduced=False, low_quality=False):
    page = browser.new_page(viewport={'width': width, 'height': {360:800,390:844,430:932}.get(width,844)}, device_scale_factor=1,
                            reduced_motion='reduce' if reduced else 'no-preference')
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    page.route(ORIGIN + '/**', serve)
    page.route('https://**/*', lambda route: route.abort())
    page.add_init_script("""window.__waapi=[];const original=Element.prototype.animate;
      Element.prototype.animate=function(...args){const animation=Reflect.apply(original,this,args);window.__waapi.push(animation);return animation;};""")
    page.add_init_script('Object.defineProperty(navigator,"hardwareConcurrency",{get:()=>'+('2' if low_quality else '8')+'})')
    page.goto(ORIGIN + '/?scene=' + scene)
    page.wait_for_function('!!window.__combat')
    page.wait_for_selector('svg[data-rig="male_viking"]')
    if scene != 'trial':
        page.wait_for_function('document.querySelectorAll("svg[data-rig]").length===2')
    page.wait_for_function('[...document.images].every(image=>image.complete)')
    return page


def set_visual(page, patch):
    page.evaluate('(patch)=>window.__combat.set(patch)', patch)
    page.wait_for_timeout(35)


def strike(key, tone='hit', attacker='Рагнар', amount=17):
    return {'key': key, 'tone': tone, 'attacker': attacker,
            'target': 'Противник' if attacker == 'Рагнар' else 'Рагнар',
            'amount': None if tone in ['block', 'dodge'] else amount}


def matrices(page, selector, milliseconds):
    return page.locator(selector).evaluate('''(svg, time)=>{
      for(const animation of svg.getAnimations({subtree:true})) {animation.pause();animation.currentTime=time;}
      return Object.fromEntries([...svg.querySelectorAll('[data-rig-part]')].map(part=>[part.dataset.rigPart,getComputedStyle(part).transform]));
    }''', milliseconds)


def feet_at(page, selector, milliseconds):
    return page.locator(selector).evaluate("""(svg,time)=>{
      for(const a of svg.getAnimations({subtree:true})){a.pause();a.currentTime=time;}
      return Object.fromEntries(['left','right'].map(side=>{
        const foot=svg.querySelector('[data-anchor=foot-'+side+']');
        const m=foot.getScreenCTM(),p=new DOMPoint(foot.cx.baseVal.value,foot.cy.baseVal.value).matrixTransform(m);
        return [side,{x:p.x,y:p.y,angle:Math.atan2(Math.abs(m.b),Math.abs(m.a))*180/Math.PI}];
      }));
    }""", milliseconds)


def visible_effects(page):
    return page.locator('.combat2d-effects [data-effect]').evaluate_all('''nodes=>nodes.filter(node=>{
      for(let el=node;el&&el!==document.body;el=el.parentElement){const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<.01)return false;}
      return true;
    }).map(el=>el.dataset.effect)''')


def verify_scene_contact(page, attacker, target, area):
    effect = page.locator('.combat2d-effects[data-contact="ready"]')
    assert effect.count() == 1, f'No measured contact: {attacker} → {target} ({area})'
    result = effect.evaluate("""(node, names)=>{
      const scene=node.closest('[data-combat-scene]'),mark=scene.querySelector('.combat2d-scene-impact');
      const box=mark.getBoundingClientRect(),x=box.left,y=box.top;
      const rigs=[...scene.querySelectorAll('svg[data-rig]')];
      const hit=rigs.find(n=>n.getAttribute('aria-label')===names.target).querySelector('[data-anchor="'+names.area+'-hit-area"]');
      const point=new DOMPoint(x,y).matrixTransform(hit.getScreenCTM().inverse());
      const normalized=((point.x-hit.cx.baseVal.value)/hit.rx.baseVal.value)**2+((point.y-hit.cy.baseVal.value)/hit.ry.baseVal.value)**2;
      const blade=rigs.find(n=>n.getAttribute('aria-label')===names.attacker).querySelector('[data-anchor="weapon-edge"]');
      const length=blade.getTotalLength(),matrix=blade.getScreenCTM();let distance=Infinity;
      for(let i=0;i<=96;i++){const p=blade.getPointAtLength(length*i/96).matrixTransform(matrix);distance=Math.min(distance,Math.hypot(p.x-x,p.y-y));}
      return {normalized,distance,motion:rigs.find(n=>n.getAttribute('aria-label')===names.attacker).dataset.motion};
    }""", {'attacker':attacker,'target':target,'area':area})
    report['max_contact_gap_px'] = max(report['max_contact_gap_px'], result['distance'])
    report['contact_measurements'].append({'width':page.viewport_size['width'],'attacker':attacker,'target':target,'area':area,**result})
    assert result['normalized'] <= 1.001 and result['distance'] <= 12.1, result
    return result


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'), headless=True, args=['--no-sandbox', '--disable-breakpad', '--disable-crash-reporter'])
    for width in [360, 390, 430]:
        page = load(browser, width)
        hero = page.locator('#fixture-hero svg[data-rig="male_viking"]')
        foe = page.locator('#fixture-enemy svg[data-rig="goblin"]')
        assert hero.count() == 1 and foe.count() == 1, 'Both real rigs must mount'
        parts = hero.locator('[data-rig-part]').evaluate_all('nodes=>nodes.map(n=>n.dataset.rigPart)')
        for name in ['root', 'torso', 'head', 'arm-right', 'forearm-right', 'weapon', 'arm-left', 'forearm-left', 'shield', 'leg-right', 'leg-left', 'knee-right', 'knee-left', 'ankle-right', 'ankle-left']:
            assert name in parts, ('Missing independently movable part', name)
        assert hero.locator('[data-rig-part="weapon"]').evaluate('el=>!!el.parentElement.closest(\'[data-rig-part="forearm-right"]\')'), 'Weapon must inherit hand motion'
        assert hero.locator('[data-rig-part="shield"]').evaluate('el=>!!el.parentElement.closest(\'[data-rig-part="forearm-left"]\')'), 'Shield must inherit hand motion'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Mobile horizontal overflow'
        page.screenshot(path=str(OUT / f'idle-{width}.png'))
        baseline = matrices(page, '#fixture-hero svg', 0)
        samples = {}
        trajectories = {}
        for key, motion in [(3, 'slash'), (4, 'thrust'), (5, 'overhead')]:
            previous = hero.locator('[data-rig-part="arm-right"]').evaluate('el=>getComputedStyle(el).transform')
            set_visual(page, {'strike': strike(key)})
            assert hero.get_attribute('data-motion') == motion
            difference = hero.locator('[data-rig-part="arm-right"]').evaluate('''(el, before)=>{
              const active=el.getAnimations().find(a=>a.effect.getTiming().duration===810);
              const a=new DOMMatrix(before),b=new DOMMatrix(active.effect.getKeyframes()[0].transform);
              return Math.max(...['a','b','c','d','e','f'].map(k=>Math.abs(a[k]-b[k])));
            }''', previous)
            assert difference < .02, f'{motion} jumps at transition: {difference}'
            # Capture world-space feet through the actual nested SVG transforms.
            samples_feet = {ms: feet_at(page, '#fixture-hero svg', ms) for ms in sorted(set(range(0,351,20)) | {250,350})}
            planted = samples_feet[0]['left']
            for ms, feet in samples_feet.items():
                drift = math.hypot(feet['left']['x']-planted['x'], feet['left']['y']-planted['y'])
                report['max_support_drift_px'] = max(report['max_support_drift_px'], drift)
                assert drift <= 3, f'{motion} support foot drift {drift:.2f}px at {ms}ms'
                assert feet['left']['angle'] <= 5, f'{motion}: planted sole tilts {feet["left"]["angle"]:.2f}°'
            assert abs(samples_feet[250]['right']['y']-samples_feet[160]['right']['y']) > .4, f'{motion}: free foot never lifts'
            assert abs(samples_feet[350]['right']['x']-samples_feet[160]['right']['x']) > 2, f'{motion}: no visible step'
            sample = matrices(page, '#fixture-hero svg', 240)
            tip = hero.locator('[data-anchor="weapon-tip"]').evaluate('''el=>{const p=new DOMPoint(el.cx.baseVal.value,el.cy.baseVal.value).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y}}''')
            trajectories[motion] = tip
            samples[motion] = sample
            for name in ['torso', 'arm-right', 'forearm-right', 'leg-right', 'leg-left', 'knee-right', 'knee-left', 'ankle-right', 'ankle-left']:
                assert sample[name] != baseline[name], f'{motion}: {name} remains static'
            page.screenshot(path=str(OUT / f'{motion}-{width}.png'))
        # The mirrored goblin uses the same foot-plant guarantee.
        for key in [21, 22, 23]:
            set_visual(page, {'strike': strike(key, attacker='Противник')})
            foot = feet_at(page, '#fixture-enemy svg', 0)['left']
            for ms in sorted(set(range(0,351,20)) | {250,350}):
                p = feet_at(page, '#fixture-enemy svg', ms)['left']
                drift = math.hypot(p['x']-foot['x'], p['y']-foot['y'])
                report['max_support_drift_px'] = max(report['max_support_drift_px'], drift)
                assert drift <= 3, f'goblin support foot drifts at {ms}ms'
                assert p['angle'] <= 5, f'goblin planted sole tilts at {ms}ms'
        for first, second in [('slash','thrust'),('slash','overhead'),('thrust','overhead')]:
            a,b=trajectories[first],trajectories[second]
            assert math.hypot(a['x']-b['x'],a['y']-b['y']) > 2, f'Weapon paths indistinguishable: {first}, {second}'
        assert len({sample['arm-right'] for sample in samples.values()}) == 3, 'Three attacks must have distinct upper-arm movement'
        assert len({sample['torso'] for sample in samples.values()}) == 3, 'Three attacks must have distinct torso movement'
        report['attacks'][str(width)] = samples
        # Release manually paused timelines by replacing the event.
        set_visual(page, {'strike': strike(6, 'block')})
        assert foe.get_attribute('data-motion') == 'block'
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / f'block-{width}.png'))
        assert any('block' in effect or 'shield' in effect for effect in visible_effects(page)) or foe.locator('[data-effect="shield-glint"]').evaluate('el=>Number(getComputedStyle(el).opacity)>.01'), 'Block glow missing at contact'
        set_visual(page, {'strike': strike(7, 'dodge')})
        assert foe.get_attribute('data-motion') == 'dodge'
        page.wait_for_timeout(390)
        effects = visible_effects(page)
        assert not any(effect in ['hit', 'crit', 'spark', 'sparks', 'shock', 'shockwave', 'contact'] for effect in effects), 'Dodge must not show damage effects'
        assert page.locator('.combat2d-scene-impact').count() == 0, 'Dodge must not create a contact flash'
        page.screenshot(path=str(OUT / f'dodge-{width}.png'))
        set_visual(page, {'strike': strike(8, 'crit')})
        assert foe.get_attribute('data-motion') == 'crit-hit'
        page.wait_for_timeout(390)
        page.screenshot(path=str(OUT / f'critical-{width}.png'))
        assert visible_effects(page), 'Critical contact effect missing'
        page.wait_for_timeout(650)
        assert not visible_effects(page), 'Contact effects outlive the strike'
        assert page.locator('.combat2d-scene-impact').count() == 0, 'Scene contact effects must be removed'
        # Event state can remain in PvP until queue retirement; pose must recover.
        assert hero.get_attribute('data-motion') == 'idle', 'Attacker must recover naturally while old event remains selected'
        # Mirroring applies to artwork coordinates while world movement keeps dir=-1.
        set_visual(page, {'strike': None, 'enemy': 'viking'})
        assert page.locator('#fixture-enemy svg[data-rig="male_viking"]').count() == 1
        mirror = page.locator('#fixture-enemy svg').evaluate('''svg=>{
          const matrix=svg.querySelector('g').getCTM();return matrix.a*matrix.d-matrix.b*matrix.c<0;
        }''')
        assert mirror, 'PvP Viking must face toward hero'
        # Real fatal contact keeps visible fighter, then holds death/victory poses.
        set_visual(page, {'enemy': 'goblin', 'strike': None})
        page.wait_for_selector('#fixture-enemy svg[data-rig="goblin"]')
        set_visual(page, {'strike': strike(9), 'foeAlive': False})
        page.wait_for_timeout(880)
        assert page.locator('#fixture-enemy svg').get_attribute('data-motion') == 'idle', 'A fatal snapshot must not collapse before queued strikes retire'
        set_visual(page, {'strike': strike(10)})
        assert page.locator('#fixture-enemy svg').get_attribute('data-motion') == 'hit'
        page.wait_for_timeout(880)
        assert page.locator('#fixture-enemy svg').get_attribute('data-motion') == 'idle'
        set_visual(page, {'strike': {'key': 99, 'attacker': 'Другой', 'target': 'Третий', 'tone': 'block', 'amount': None}})
        assert page.locator('#fixture-enemy svg').get_attribute('data-motion') == 'idle', 'Wait for whole queue, including other participants'
        set_visual(page, {'strike': None, 'heroWon': True})
        page.wait_for_timeout(60)
        assert page.locator('#fixture-enemy svg').get_attribute('data-motion') == 'death'
        page.evaluate("window.__deathAnimations=document.querySelector('#fixture-enemy svg').getAnimations({subtree:true})")
        set_visual(page, {'strike': {'key': 100, 'attacker': 'Другой', 'target': 'Третий', 'tone': 'hit', 'amount': 7}})
        assert page.evaluate("document.querySelector('#fixture-enemy svg').getAnimations({subtree:true}).every(a=>window.__deathAnimations.includes(a))"), 'Retiring final strike must not restart death from stance'
        set_visual(page, {'strike': strike(11, 'crit')})
        assert page.locator('#fixture-enemy svg').get_attribute('data-motion') == 'death', 'Late confirmed event must not revive a collapsed fighter'
        assert page.evaluate("document.querySelector('#fixture-enemy svg').getAnimations({subtree:true}).every(a=>window.__deathAnimations.includes(a))"), 'Late key/tone must not restart terminal animation'
        page.wait_for_timeout(60)
        assert hero.get_attribute('data-motion') == 'victory'
        page.wait_for_timeout(850)
        assert hero.is_visible() and page.locator('#fixture-enemy svg').is_visible(), 'End of battle must not remove fighters'
        page.screenshot(path=str(OUT / f'victory-{width}.png'))
        report['viewports'].append({'width': width, 'height': {360:800,390:844,430:932}[width], 'parts': parts, 'overflow': False})
        page.close()

    page = load(browser)
    set_visual(page, {'speed': 2, 'strike': strike(10)})
    durations = page.evaluate("window.__waapi.filter(a=>a.effect.target.closest('#fixture-hero')).map(a=>a.effect.getTiming().duration).filter(d=>Number.isFinite(d))")
    assert durations and max(durations) <= 450, ('x2 must halve event durations', durations)
    # The planted foot follows the same geometry at double speed.
    foot = feet_at(page, '#fixture-hero svg', 0)['left']
    for ms in [50,80,125,175]:
        current = feet_at(page, '#fixture-hero svg', ms)['left']
        assert math.hypot(current['x']-foot['x'], current['y']-foot['y']) <= 3
        assert current['angle'] <= 5
    page.wait_for_timeout(480)
    assert page.locator('#fixture-hero svg').get_attribute('data-motion') == 'idle'
    set_visual(page, {'strike': strike(11)})
    page.evaluate('window.__combat.unmount()')
    page.wait_for_timeout(40)
    states = page.evaluate('window.__waapi.map(a=>a.playState)')
    assert all(state in ['idle', 'finished'] for state in states), ('Unmount leaves active detached animations', states)
    assert page.locator('svg[data-rig]').count() == 0
    report['speed2_durations_ms'] = durations
    report['unmounted_animation_states'] = states
    page.close()

    page = load(browser, reduced=True)
    set_visual(page, {'strike': strike(12, 'crit')})
    page.wait_for_timeout(60)
    animations = page.locator('svg[data-rig]').evaluate_all('nodes=>nodes.flatMap(svg=>svg.getAnimations({subtree:true}).map(a=>({duration:a.effect.getTiming().duration,iterations:a.effect.getTiming().iterations})))')
    assert all(a['iterations'] != float('inf') and a['duration'] <= 150 for a in animations), ('Reduced-motion must avoid large/continuous body motion', animations)
    page.screenshot(path=str(OUT / 'reduced-motion-390.png'))
    report['reduced_motion_animations'] = animations
    page.close()

    for width in [360, 390, 430]:
        page = load(browser, width, 'arena')
        assert page.locator('svg[data-rig="male_viking"]').count() == 2, 'Actual PvP scene must use both rigs'
        assert page.get_by_role('button', name='УДАР', exact=True).is_disabled()
        # Both defense and attack zone controls remain real production controls.
        page.get_by_role('button', name='Голова', exact=True).first.click()
        page.get_by_role('button', name='Грудь', exact=True).first.click()
        page.get_by_role('button', name='Живот', exact=True).last.click()
        assert page.get_by_role('button', name='УДАР', exact=True).is_enabled()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(OUT / f'arena-{width}.png'))
        for key in [15, 16, 17]:
            set_visual(page, {'strike': strike(key)})
            # Freeze the production WAAPI timelines at contact for a deterministic
            # geometry check while the real contact timer runs once.
            page.evaluate("""()=>document.querySelectorAll('svg[data-rig]').forEach(svg=>svg.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=350;}))""")
            page.wait_for_timeout(380)
            effects = page.locator('.combat2d-effects[data-contact="ready"]')
            assert effects.count() == 1, f'No physical contact at 350ms, attack {key}, {width}px'
            check = effects.evaluate("""node=>{
              const scene=node.closest('[data-combat-scene]'), mark=scene.querySelector('.combat2d-scene-impact');
              const box=mark.getBoundingClientRect(),x=box.left,y=box.top;
              const hit=scene.querySelector('svg[aria-label="Противник"] [data-anchor="torso-hit-area"]');
              const local=new DOMPoint(x,y).matrixTransform(hit.getScreenCTM().inverse());
              const normalized=((local.x-hit.cx.baseVal.value)/hit.rx.baseVal.value)**2+((local.y-hit.cy.baseVal.value)/hit.ry.baseVal.value)**2;
              const blade=scene.querySelector('svg[aria-label="Рагнар"] [data-anchor="weapon-edge"]');
              const length=blade.getTotalLength(),matrix=blade.getScreenCTM();let distance=Infinity;
              for(let i=0;i<=96;i++){const p=blade.getPointAtLength(length*i/96).matrixTransform(matrix);distance=Math.min(distance,Math.hypot(p.x-x,p.y-y));}
              return {normalized,distance};
            }""")
            report['max_contact_gap_px'] = max(report['max_contact_gap_px'], check['distance'])
            assert check['normalized'] <= 1.001 and check['distance'] <= 12.1, (key,width,check)
            report['contact_measurements'].append({'width':width,'attacker':'Рагнар','target':'Противник','area':'torso','motion':str(key),**check})
            if key == 15:
                page.screenshot(path=str(OUT / f'arena-contact-{width}.png'))
                if width == 390:
                    set_visual(page, {'strike': None})
                    page.wait_for_timeout(150)
                    set_visual(page, {'strike': strike(24)})
                    started = time.monotonic() - .035
                    for phase, moment in [('start',0),('windup',160),('contact',350),('recoil',410),('recovery',600),('settle',810)]:
                        remaining = moment - (time.monotonic() - started) * 1000
                        if remaining > 0: page.wait_for_timeout(remaining)
                        if phase == 'contact':
                            page.wait_for_selector('.combat2d-scene-impact', timeout=500)
                            page.evaluate("""()=>{const marker=document.createElement('span');marker.id='test-contact-marker';Object.assign(marker.style,{position:'absolute',left:'-3px',top:'-3px',width:'7px',height:'7px',border:'1px solid red',borderRadius:'50%',zIndex:'100'});document.querySelector('.combat2d-scene-impact').append(marker)}""")
                        page.screenshot(path=str(OUT / f'sequence-pvp-{phase}.png'))
                        if phase == 'contact': page.locator('#test-contact-marker').evaluate('el=>el.remove()')
        # A block must intersect the shield itself, not the torso.
        for block_key in [18,19,20]:
            set_visual(page, {'strike': strike(block_key, 'block')})
            page.evaluate("""()=>document.querySelectorAll('svg[data-rig]').forEach(svg=>svg.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=350;}))""")
            page.wait_for_timeout(380)
            effect = page.locator('.combat2d-effects[data-contact="ready"]')
            assert effect.count() == 1, f'Sword misses shield at {width}px'
            inside = effect.evaluate("""node=>{
              const scene=node.closest('[data-combat-scene]'),mark=scene.querySelector('.combat2d-scene-impact');
              const box=mark.getBoundingClientRect(),x=box.left,y=box.top;
              const hit=scene.querySelector('svg[aria-label="Противник"] [data-anchor="shield-hit-area"]');
              const p=new DOMPoint(x,y).matrixTransform(hit.getScreenCTM().inverse());
              return ((p.x-hit.cx.baseVal.value)/hit.rx.baseVal.value)**2+((p.y-hit.cy.baseVal.value)/hit.ry.baseVal.value)**2;
            }""")
            assert inside <= 1.001, ('Block effect outside shield',width,inside)
            verify_scene_contact(page, 'Рагнар', 'Противник', 'shield')
        # The smaller mirrored PvP Viking must also reach the hero's body and shield.
        for tone, keys in [('hit',[30,31,32]), ('block',[33,34,35])]:
            for key in keys:
                set_visual(page, {'strike': strike(key, tone=tone, attacker='Противник')})
                page.evaluate("""()=>document.querySelectorAll('svg[data-rig]').forEach(svg=>svg.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=350;}))""")
                page.wait_for_selector('.combat2d-scene-impact', timeout=1000)
                verify_scene_contact(page, 'Противник', 'Рагнар', 'shield' if tone == 'block' else 'torso')
        page.close()
        for mode in ['pve', 'trial']:
            page = load(browser, width, mode)
            assert page.locator('svg[data-rig="male_viking"]').count() == 1
            if mode == 'pve':
                assert page.locator('svg[data-rig="goblin"]').count() == 1
            else:
                assert page.locator('img[src*="bosses/barrow_guardian"]').count() == 1, 'Actual trial boss must safely keep its approved unrigged artwork'
            assert page.get_by_role('button', name='УДАР', exact=True).is_disabled()
            page.get_by_role('button', name='Защита: Голова', exact=True).click()
            page.get_by_role('button', name='Защита: Грудь', exact=True).click()
            page.get_by_role('button', name='Удар: Живот', exact=True).click()
            assert page.get_by_role('button', name='УДАР', exact=True).is_enabled()
            if mode == 'pve': page.evaluate('Math.random=()=>0.5')
            page.get_by_role('button', name='УДАР', exact=True).click()
            page.wait_for_timeout(120)
            assert page.locator('svg[data-motion="slash"],svg[data-motion="thrust"],svg[data-motion="overhead"]').count() >= 1, 'Actual playRound event must animate rig'
            page.screenshot(path=str(OUT / f'{mode}-manual-{width}.png'))
            if mode == 'pve':
                # Change x1/x2 while an actual playRound strike is active: the
                # existing round keeps the same animation object and timing.
                page.evaluate("""()=>{const root=document.querySelector('svg[data-rig=male_viking] [data-rig-part=root]');window.__roundAnimation=root.getAnimations().find(a=>a.effect.getTiming().duration===810)}""")
                assert page.evaluate('!!window.__roundAnimation')
                page.get_by_role('button', name='Скорость боя', exact=True).click()
                assert page.evaluate("""()=>{const root=document.querySelector('svg[data-rig=male_viking] [data-rig-part=root]');return root.getAnimations().includes(window.__roundAnimation)&&window.__roundAnimation.effect.getTiming().duration===810}""")
                if width == 390: page.screenshot(path=str(OUT / 'sequence-pve-start.png'))
            page.wait_for_timeout(230)
            page.screenshot(path=str(OUT / f'{mode}-contact-{width}.png'))
            if mode == 'pve':
                page.wait_for_timeout(65)
                assert page.locator('.combat2d-effects[data-contact="pending"]').count() == 0, f'PvE contact geometry missed at {width}px'
                assert page.locator('.combat2d-effects[data-contact="ready"]').count() == 1, f'PvE contact missing at {width}px'
                if width == 390: page.screenshot(path=str(OUT / 'sequence-pve-contact.png'))
                page.wait_for_timeout(450)
                if width == 390: page.screenshot(path=str(OUT / 'sequence-pve-finish.png'))
                page.wait_for_timeout(1155)
            else:
                page.wait_for_timeout(1670)
            assert page.get_by_text('Пояс с эликсирами', exact=True).is_visible()
            assert page.get_by_text('Снаряжение', exact=False).count() >= 1
            if page.evaluate('window.__combat.game().settings.speed') != 2:
                page.get_by_role('button', name='Скорость боя', exact=True).click()
            assert page.evaluate('window.__combat.game().settings.speed') == 2
            page.get_by_role('button', name='Авто бой', exact=False).click()
            page.wait_for_timeout(550)
            assert page.evaluate('window.__combat.game().settings.auto') is True
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(OUT / f'{mode}-auto-x2-{width}.png'))
            page.close()
    # Real PvE rounds: all three hero/goblin attacks in both directions,
    # shield impacts, plus an independently started x2 round.
    for width in [360, 390, 430]:
        page = load(browser, width, 'pve')
        page.evaluate('Math.random=()=>0.5')
        for motion in ['overhead', 'thrust', 'slash']:
            for label in ['Защита: Голова', 'Защита: Грудь', 'Удар: Живот']:
                page.get_by_role('button',name=label,exact=True).click()
            page.get_by_role('button',name='УДАР',exact=True).click()
            page.wait_for_timeout(80)
            page.evaluate("""()=>document.querySelectorAll('svg[data-rig]').forEach(svg=>svg.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=350;}))""")
            page.wait_for_selector('.combat2d-scene-impact', timeout=1000)
            verify_scene_contact(page, 'Рагнар', 'Гоблин', 'torso')
            if width == 390 and motion == 'overhead':
                page.wait_for_timeout(50)
                page.evaluate("""()=>{const marker=document.createElement('span');marker.id='test-contact-marker';Object.assign(marker.style,{position:'absolute',left:'-3px',top:'-3px',width:'7px',height:'7px',border:'1px solid red',borderRadius:'50%',zIndex:'100'});document.querySelector('.combat2d-scene-impact').append(marker)}""")
                page.screenshot(path=str(OUT / 'sequence-pve-contact.png'))
                page.locator('#test-contact-marker').evaluate('el=>el.remove()')
            page.wait_for_selector('svg[aria-label="Гоблин"][data-motion="'+motion+'"]')
            page.evaluate("""()=>document.querySelectorAll('svg[data-rig]').forEach(svg=>svg.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=350;}))""")
            page.wait_for_selector('.combat2d-scene-impact', timeout=1000)
            verify_scene_contact(page, 'Гоблин', 'Рагнар', 'torso')
            if width == 390:
                page.wait_for_timeout(50)
                page.screenshot(path=str(OUT / f'sequence-pve-goblin-{motion}.png'))
            page.wait_for_timeout(650)
        page.close()
        for labels, attacker, target, second in [
          (['Защита: Голова','Защита: Грудь','Удар: Голова'],'Рагнар','Гоблин',False),
          (['Защита: Живот','Защита: Грудь','Удар: Живот'],'Гоблин','Рагнар',True)]:
            page = load(browser, width, 'pve')
            page.evaluate('Math.random=()=>0.5')
            for index, motion in enumerate(['overhead','thrust','slash'] if second else ['thrust','slash','overhead']):
                for label in labels: page.get_by_role('button',name=label,exact=True).click()
                page.get_by_role('button',name='УДАР',exact=True).click()
                if second: page.wait_for_selector('svg[aria-label="Гоблин"][data-motion="'+motion+'"]')
                else: page.wait_for_selector('svg[aria-label="Рагнар"][data-motion="'+motion+'"]')
                page.evaluate("""()=>document.querySelectorAll('svg[data-rig]').forEach(svg=>svg.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=350;}))""")
                page.wait_for_selector('.combat2d-scene-impact', timeout=1000)
                verify_scene_contact(page, attacker, target, 'shield')
                if width == 390 and index == 0:
                    page.wait_for_timeout(50)
                    page.screenshot(path=str(OUT / ('sequence-pve-hero-block.png' if second else 'sequence-pve-goblin-block.png')))
                page.wait_for_timeout(650 if second else 1500)
            page.close()
        page = load(browser, width, 'pve')
        page.evaluate('Math.random=()=>0.5')
        page.get_by_role('button',name='Скорость боя',exact=True).click()
        for label in ['Защита: Голова','Защита: Грудь','Удар: Живот']:
            page.get_by_role('button',name=label,exact=True).click()
        page.get_by_role('button',name='УДАР',exact=True).click()
        page.wait_for_timeout(60)
        page.evaluate("""()=>document.querySelectorAll('svg[data-rig]').forEach(svg=>svg.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=175;}))""")
        page.wait_for_selector('.combat2d-scene-impact', timeout=1000)
        verify_scene_contact(page, 'Рагнар', 'Гоблин', 'torso')
        page.wait_for_selector('svg[aria-label="Гоблин"][data-motion="overhead"]')
        page.evaluate("""()=>document.querySelectorAll('svg[data-rig]').forEach(svg=>svg.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=175;}))""")
        page.wait_for_selector('.combat2d-scene-impact', timeout=1000)
        verify_scene_contact(page, 'Гоблин', 'Рагнар', 'torso')
        page.close()

    # Observe the existing idle cycle for more than three seconds; the body,
    # wrist and shield must move while the root stays grounded.
    page = load(browser, 390)
    page.wait_for_timeout(200)
    def idle_pose():
        return page.locator('#fixture-hero svg').evaluate("""svg=>Object.fromEntries(['root','torso','head','forearm-right','shield','hair'].map(part=>[part,getComputedStyle(svg.querySelector('[data-rig-part="'+part+'"]')).transform]))""")
    first = idle_pose()
    page.wait_for_timeout(1600)
    middle = idle_pose()
    page.wait_for_timeout(1600)
    last = idle_pose()
    assert first['root'] == middle['root'] == last['root'], 'Idle must not bounce the whole fighter'
    for part in ['torso','head','forearm-right','shield','hair']:
        assert len({first[part],middle[part],last[part]}) > 1, f'Idle joint {part} remains static'
    report['idle_observed_seconds'] = 3.2
    page.close()

    page = load(browser, low_quality=True)
    set_visual(page, {'strike': strike(13, 'block')})
    page.wait_for_timeout(380)
    assert page.locator('.combat2d-effects[data-quality="low"]').count() == 2
    assert 'block' not in visible_effects(page), 'Low quality should suppress auxiliary rings'
    assert page.locator('#fixture-enemy [data-effect="shield-glint"]').evaluate('el=>Number(getComputedStyle(el).opacity)>.01'), 'Low quality keeps shield feedback'
    page.close()

    # A missing cutout must retain this same approved hero, not an invisible rig.
    page = browser.new_page(viewport={'width': 360, 'height': 844})
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    def failed_cutout(route):
        if route.request.url.endswith('/combat2d/male_viking/weapon.webp'):
            route.fulfill(status=404, body='intentional missing cutout')
        else:
            serve(route)
    page.route(ORIGIN + '/**', failed_cutout)
    page.route('https://**/*', lambda route: route.abort())
    page.goto(ORIGIN + '/')
    page.wait_for_selector('#fixture-enemy svg[data-rig="goblin"]')
    page.wait_for_timeout(150)
    assert page.locator('#fixture-hero svg[data-rig]').count() == 0
    assert page.locator('#fixture-hero img').get_attribute('src').endswith('/heroes/male_viking/idle.webp')
    assert page.locator('#fixture-hero img').evaluate('img=>img.complete&&img.naturalWidth>0')
    report['missing_cutout_same_hero_fallback'] = True
    page.close()

    # Informational renderer pacing in this headless environment only.
    page = load(browser)
    set_visual(page, {'strike': strike(14, 'crit')})
    pacing = page.evaluate('''()=>new Promise(resolve=>{
      let last=performance.now(),deltas=[];function frame(now){deltas.push(now-last);last=now;if(deltas.length>=40){deltas.sort((a,b)=>a-b);resolve({frames:40,median_ms:deltas[20],p95_ms:deltas[38],over33ms:deltas.filter(d=>d>33.4).length});}else requestAnimationFrame(frame);}requestAnimationFrame(frame);
    })''')
    report['headless_attack_frame_pacing'] = pacing
    page.close()
    browser.close()
    assert not report['errors'], report['errors']
    assert not report['missing_assets'], report['missing_assets']

(OUT / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print('Combat browser PASS: real rigs, independent limbs, three attacks, block/dodge/crit, effects lifetime, mirror, death/victory, x2, reduced motion, unmount cleanup; production PvP/PvE/trial controls at 360/390/430px. Offline Chromium emulation; no Telegram/network PvP/physical-device claim.')
