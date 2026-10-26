"""Real gear comparison and forge modal at four mobile widths, offline fixtures."""
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
def serve(route):
 path=urlparse(route.request.url).path
 file=Path('/tmp/stage8-gear-preview.html') if path=='/' else ROOT/'public'/path.lstrip('/')
 assert file.is_file(),f'Missing fixture asset: {file}'
 route.fulfill(body=file.read_bytes(),content_type='text/html' if path=='/' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
def contained(locator,width,height=None):
 rect=locator.bounding_box()
 assert rect and rect['x']>=-1 and rect['x']+rect['width']<=width+1,f'Horizontal overflow: {rect}'
 if height is not None:assert rect['y']>=-1 and rect['y']+rect['height']<=height+1,f'Vertical overflow: {rect}'
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 cases=[]
 for width,ios in product([320,375,390,430],[False,True]):
  page=browser.new_page(viewport={'width':width,'height':760},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.route(ORIGIN+'/**',serve)
  page.route('https://**/*',lambda route:route.abort())
  if ios:page.add_init_script("document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('territory-ios-webapp'))")
  page.goto(ORIGIN+'/')
  card=page.get_by_role('button',name='Клинок дозорного, Оружие, уровень 3',exact=True)
  card.wait_for();card.click()
  comparison=page.locator('.gear-compare-panel');comparison.wait_for();comparison.scroll_into_view_if_needed()
  contained(comparison,width)
  assert page.locator('.gear-compare-side').count()==2
  assert 'Старый клинок' in page.locator('.gear-compare-worn').inner_text()
  assert 'Клинок дозорного' in page.locator('.gear-compare-target').inner_text()
  assert page.locator('.gear-positive').count()>0,'Actual stat improvement must be shown'
  for button in page.locator('.gear-compare-actions button').all():contained(button,width)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=str(OUT/f'comparison-{width}-ios{ios}.png'))
  page.get_by_role('button',name='В кузницу',exact=True).click()
  panel=page.locator('.forge-upgrade-panel');panel.wait_for()
  page.wait_for_function("[...document.getAnimations()].every(a=>a.playState!=='running')")
  contained(panel,width,760)
  assert 'Клинок дозорного' in panel.inner_text()
  assert 'Следующий уровень (при успехе)' in panel.inner_text()
  upgrade=page.get_by_role('button',name='Улучшить',exact=True)
  assert upgrade.is_enabled();contained(upgrade,width,760)
  page.screenshot(path=str(OUT/f'forge-{width}-ios{ios}.png'))
  assert not errors,errors
  cases.append({'width':width,'iosPortal':ios,'comparison':True,'statDeltas':True,'forgeModal':True,'upgradeButtonVisible':True,'pageErrors':errors})
  page.close()
 browser.close()
(OUT/'gear-report.json').write_text(json.dumps({'environment':'Chromium, actual GearShowcase/ForgeScreen and production CSS; offline display fixtures','scope':'Layout, comparison, navigation, upgrade preview; server mutations tested separately in PGlite','viewports':cases},ensure_ascii=False,indent=2))
print('Stage8 gear mobile PASS: comparison panels/stat deltas and forge upgrade dialogs fit 320/375/390/430px with generic and iOS portal markup. Real components and CSS, offline display fixture.')
