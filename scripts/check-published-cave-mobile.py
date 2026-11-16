"""Read-only mobile smoke of the actual published standalone cave; no live account."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE='https://w0980077002-create.github.io/territory-game-builde/'
OUT=Path('artifacts/published-cave-mobile');OUT.mkdir(parents=True,exist_ok=True)
reports=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for width,height in [(320,568),(360,640),(390,844),(430,740)]:
        ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=True,has_touch=True,device_scale_factor=1)
        page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        # The published HTML has connect-src 'none'; never authenticate or touch an account.
        response=page.goto(BASE+'territory-cave-demo.html',wait_until='load',timeout=60000)
        assert response.status==200
        assert page.evaluate('typeof window.__caveDemo')=='undefined'
        page.get_by_role('button',name='В путь').tap()
        page.locator('.cx-portals button').first.wait_for()
        assert page.locator('.cx-portals button').count()==3
        for b in page.locator('.cx-portals button').all():
            box=b.bounding_box();assert box['height']>=44 and box['x']>=0 and box['x']+box['width']<=width+1
        page.screenshot(path=str(OUT/f'{width}-published-portals.png'))
        page.locator('.cx-portals button').nth(2).tap()
        page.wait_for_function("()=>document.querySelector('.cx-stage').dataset.phase==='FIGHT'",timeout=45000)
        assert page.get_by_test_id('cx-umbra-slot').count()==12 and page.get_by_test_id('cx-wings-slot').count()==1
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1')
        page.screenshot(path=str(OUT/f'{width}-published-crystal-fight.png'))
        page.get_by_role('button',name='Пауза',exact=True).tap();page.wait_for_timeout(150)
        pixels=page.locator('canvas').evaluate('(c)=>c.toDataURL()');page.wait_for_timeout(200)
        assert page.locator('canvas').evaluate('(c)=>c.toDataURL()')==pixels
        assert not errors,errors
        reports.append({'viewport':f'{width}x{height}','url':page.url,'result':'PASS','physical_telegram':False})
        print(reports[-1],flush=True);ctx.close()
    browser.close()
(OUT/'report.json').write_text(json.dumps(reports,indent=2))
