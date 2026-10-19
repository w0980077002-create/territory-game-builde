#!/usr/bin/env python3
"""Interaction + overflow checks against REAL offline React screens.
This is a Chromium approximation of Telegram WebView; native device QA is still needed.
No Supabase sessions, auth or production network requests.
"""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

html = Path(sys.argv[1] if len(sys.argv) > 1 else "public/qa-responsive-visual.html").resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/responsive-screen-shots")
out.mkdir(parents=True, exist_ok=True)
if not html.exists():
    raise SystemExit(f"Missing offline preview: {html}")
url = html.as_uri()

screens = ["city","equipment","items","forge","shop","profile","map","quests","games"]
sizes = [(320,740,560),(375,812,650),(393,852,690),(430,932,770)]
failures=[]
records=[]

def assert_rect(page, selector, label, shell, min_height=0):
    locator=page.locator(selector).first
    locator.wait_for(state="visible",timeout=5000)
    rect=locator.bounding_box()
    if not rect:
        raise AssertionError(f"{label}: no rectangle")
    if rect['x'] < shell['x']-2 or rect['x']+rect['width']>shell['x']+shell['width']+2:
        raise AssertionError(f"{label}: extends horizontally beyond Telegram shell: {rect} vs {shell}")
    if rect['y'] < shell['y']-2 or rect['y']+rect['height']>shell['y']+shell['height']+2:
        raise AssertionError(f"{label}: extends vertically beyond Telegram shell: {rect} vs {shell}")
    if rect['height']<min_height:
        raise AssertionError(f"{label}: too small: {rect}")
    return rect

def hit_button(page, locator, label):
    locator.scroll_into_view_if_needed(timeout=3000)
    locator.wait_for(state="visible",timeout=3000)
    locator.evaluate("""button=>{ const rect=button.getBoundingClientRect();
      const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
      const hit=document.elementFromPoint(x,y);
      if(!hit || (hit!==button&&!button.contains(hit)))
        throw new Error('Tap blocked for '+button.getAttribute('aria-label')+' by '+(hit?.tagName??'nothing'));
    }""")

def action(page,screen,shell):
    if screen=="forge":
        page.locator('[data-screen-root] button.card').first.click(timeout=4500)
        assert_rect(page,'.forge-upgrade-panel','forge panel',shell,60)
        hit_button(page,page.locator('.forge-upgrade-actions button'),'forge upgrade')
        page.screenshot(path=str(out/f"{screen}-dialog.png"))
        page.locator('.forge-upgrade-panel > div:first-child button').click()
        if page.locator('.forge-upgrade-overlay').count():
            raise AssertionError('Forge modal did not close')
    elif screen=="items":
        page.locator('[data-screen-root] .grid.grid-cols-2 button').first.click(timeout=4500)
        assert_rect(page,'.inventory-item-overlay > .card','inventory item dialog',shell,60)
        hit_button(page,page.locator('.inventory-item-overlay button[aria-label="Закрыть"]'),'inventory close')
        page.screenshot(path=str(out/f"{screen}-dialog.png"))
        page.locator('.inventory-item-overlay button[aria-label="Закрыть"]').click()
        page.get_by_role('tab',name='Спутники').click()
        if page.get_by_role('tab',name='Спутники').get_attribute('aria-selected')!="true":
            raise AssertionError('Inventory tab did not switch')
    elif screen=="equipment":
        page.locator('.gear-equipped-slot').first.click(timeout=4500)
        panel=page.locator('.gear-compare-panel')
        panel.wait_for(state="visible",timeout=3000)
        panel.scroll_into_view_if_needed(timeout=4000)
        if panel.bounding_box()['width']>shell['width']+1:
            raise AssertionError('Equipment comparison panel too wide')
        page.screenshot(path=str(out/f"{screen}-detail.png"))
    elif screen=="shop":
        page.locator('[data-screen-root] .grid.grid-cols-2 button').first.click(timeout=4500)
        assert_rect(page,'.territory-modal-panel','shop purchase modal',shell,60)
        hit_button(page,page.locator('.territory-modal-panel button[aria-label="Закрыть"]'),'shop modal close')
        page.screenshot(path=str(out/f"{screen}-dialog.png"))
        page.locator('.territory-modal-panel button[aria-label="Закрыть"]').click()
        if page.get_by_role('dialog').count():
            raise AssertionError('Shop modal did not close')

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--disable-web-security'])
    for platform in ['ios','android']:
        for width,height,sheet in sizes:
            context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1,is_mobile=True,has_touch=True)
            for screen in screens:
                page=context.new_page()
                runtime_errors=[]
                page.on('pageerror',lambda error:runtime_errors.append(str(error)))
                params=urlencode(dict(screen=screen,platform=platform,sheet=sheet,language='ru'))
                try:
                    page.goto(url+'?'+params,wait_until='load',timeout=15000)
                    # Test stable reachability, not an intermediate keyframe of
                    # slide-up/scale transitions. Motion itself is covered by
                    # separate visual checks and must not create false failures.
                    page.add_style_tag(content='*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}')
                    root=page.locator('[data-testid="offline-qa"]')
                    root.wait_for(state='visible',timeout=9000)
                    page.wait_for_timeout(220)
                    shell=root.bounding_box()
                    if not shell: raise AssertionError('Missing shell')
                    if shell['height']>sheet+2 or shell['height']<sheet-2:
                        raise AssertionError(f'Shell height {shell["height"]} should be {sheet}')
                    if page.locator('[data-testid="qa-nav"] button').count()!=7:
                        raise AssertionError('Main nav not rendered')
                    nav=assert_rect(page,'[data-testid="qa-nav"]','pinned bottom nav',shell,44)
                    if nav['y']+nav['height']>shell['y']+shell['height']+2:
                        raise AssertionError('Bottom navigation clipped')
                    overflow=page.evaluate("""()=>({
                        document:document.documentElement.scrollWidth-innerWidth,
                        shell:document.querySelector('.territory-shell').scrollWidth-document.querySelector('.territory-shell').clientWidth
                    })""")
                    if overflow['shell']>2:
                        raise AssertionError(f'Sideways scrolling in shell: {overflow}')
                    if runtime_errors:
                        raise AssertionError('React exception: '+runtime_errors[0][:300])
                    # Save snapshots of all screen entry points at iPhone 14/15 widths.
                    if width in (375,393):
                        page.screenshot(path=str(out/f"{platform}-{width}-{screen}.png"))
                    if width in (320,393):
                        action(page,screen,shell)
                    if runtime_errors:
                        raise AssertionError('Runtime error after tap: '+runtime_errors[0][:300])
                    records.append(dict(platform=platform,width=width,height=height,sheet=sheet,screen=screen,status='pass'))
                except Exception as exc:
                    failures.append(f'{platform} {width}x{height} / sheet {sheet} / {screen}: {exc}')
                    records.append(dict(platform=platform,width=width,height=height,sheet=sheet,screen=screen,status='fail',message=str(exc)[:400]))
                finally:
                    page.close()
            context.close()
    browser.close()

report=dict(cases=len(records),passed=sum(x['status']=='pass' for x in records),failures=failures,results=records)
(out/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({key:report[key] for key in ['cases','passed','failures']},ensure_ascii=False,indent=2))
if failures: sys.exit(1)
