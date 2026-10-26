"""Offline actual component/CSS/API parser at requested mobile widths.
Transport fixtures deliberately do not prove server authorization or physical Telegram behavior.
"""
from pathlib import Path
from urllib.parse import urlparse
import json
import mimetypes
import shutil
from itertools import product
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'work'/'professions-mobile'
OUT.mkdir(parents=True,exist_ok=True)
ORIGIN='http://127.0.0.1:4173'
report={'environment':'Chromium, actual Stage8 screen/CSS/API parser, offline RPC fixtures','scope':'Profession recipe visibility, bounds, immediate craft confirmation; not physical Telegram or inventory comparison dialog','viewports':[]}
def serve(route):
 path=urlparse(route.request.url).path
 file=Path('/tmp/professions-stage8-preview.html') if path=='/' else ROOT/'public'/path.lstrip('/')
 assert file.is_file(),f'Missing fixture asset: {file}'
 route.fulfill(body=file.read_bytes(),content_type='text/html' if path=='/' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
catalog=json.loads((ROOT/'supabase/staged/territory_profession_stage8_catalog.json').read_text())
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 for width,profession in product([320,375,390,430],['smith','alchemist','artisan','jeweler','engineer']):
  recipes=[r for r in catalog['recipes'] if r['profession']==profession]
  crafted=next(r for r in recipes if r['kind']=='item')
  page=browser.new_page(viewport={'width':width,'height':760},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.route(ORIGIN+'/**',serve)
  page.route('https://**/*',lambda route:route.abort())
  page.add_init_script('window.__profession='+json.dumps(profession))
  page.goto(ORIGIN+'/')
  page.get_by_text('Защищённые профессии',exact=True).wait_for()
  page.get_by_role('button',name='Все',exact=True).click()
  assert page.locator('article').count()==len(recipes),'All recipes and practices must be reachable'
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Horizontal document overflow'
  for button in page.locator('article button').all():
   button.scroll_into_view_if_needed()
   rect=button.bounding_box()
   assert rect['x']>=0 and rect['x']+rect['width']<=width+1,f'Button exceeds {width}px screen: {rect}'
   assert rect['height']>=28,'Craft control text clipped'
  page.get_by_role('textbox',name='Найти рецепт').fill(crafted['output']['name'])
  assert page.locator('article').count()==1
  page.get_by_role('button',name='Создать предмет',exact=True).click()
  page.get_by_text('Предмет создан и подтверждён сервером.',exact=True).wait_for()
  assert page.evaluate('window.__craftCalls.length')==1
  see=page.get_by_role('button',name='Посмотреть созданную вещь в инвентаре',exact=True)
  see.scroll_into_view_if_needed()
  rect=see.bounding_box()
  assert rect['x']>=0 and rect['x']+rect['width']<=width+1
  see.click()
  assert page.evaluate('window.__navigate.screen')=='inventory'
  assert page.evaluate('window.__navigate.tab')==('equipment' if crafted['output']['type']=='equipment' else 'items')
  assert not errors,errors
  page.screenshot(path=str(OUT/f'workshop-{profession}-{width}.png'),full_page=True)
  report['viewports'].append({'width':width,'profession':profession,'recipes':len(recipes),'craftConfirmed':True,'inventoryNavigation':True,'pageErrors':errors})
  page.close()
 browser.close()
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('Stage8 mobile PASS: 320/375/390/430px, all five professions and all 72 recipes, contained controls, actual API parser, immediate crafted result and inventory navigation. Offline fixtures; see work/professions-mobile/report.json.')
