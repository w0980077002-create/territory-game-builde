"""Production roster + PveFight, isolated transport. Chromium is NOT Android Telegram."""
import json, mimetypes, shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/tmp/territory-goose-evidence');OUT.mkdir(exist_ok=True)
ORIGIN='http://127.0.0.1:4173'
def serve(r):
 p=urlparse(r.request.url).path
 f=Path('/tmp/territory-goose-preview.html') if p=='/' else ROOT/'public'/p.lstrip('/')
 if f.is_file():r.fulfill(body=f.read_bytes(),content_type='text/html' if p=='/' else mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
 else:r.fulfill(status=404,body='missing '+p)
def prepare(b,width,lang,query):
 page=b.new_page(viewport={'width':width,'height':844},**({'record_video_dir':str(OUT/'video'),'record_video_size':{'width':width,'height':844}} if 'boss' in query else {}))
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("localStorage.setItem('territory-language', '"+lang+"');Math.random=()=>.5")
 page.route(ORIGIN+'/**',serve);page.route('https://**/*',lambda r:r.abort())
 page.goto(ORIGIN+'/?'+query);page.wait_for_timeout(500)
 return page,errors
def turn(page,lang):
 en=lang=='en'
 for z in (['Head','Legs'] if en else ['Голова','Ноги']):
  btn=page.get_by_role('button',name=('Defense: ' if en else 'Защита: ')+z,exact=True)
  if btn.get_attribute('aria-pressed')!='true':btn.click()
 page.get_by_role('button',name=('Attack: Chest' if en else 'Удар: Грудь'),exact=True).click()
 page.get_by_role('button',name=('STRIKE' if en else 'УДАР'),exact=True).click()
 seen=set()
 for _ in range(65):
  seen.add(page.locator('.goose-companion').first.get_attribute('data-action'));page.wait_for_timeout(60)
 return seen
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--disable-breakpad','--disable-crash-reporter'])
 for w in (320,360,390,430):
  for lang in ('ru','en'):
   page,errors=prepare(b,w,lang,'')
   goose=page.locator('.followers-camp__portrait',has_text='Goose Hugger' if lang=='en' else 'Гусь-Обнимусь');assert goose.count()==1;goose.click()
   page.locator('.followers-camp__portrait').first.click();page.locator('.followers-camp__choose').click();goose.click()
   assert page.locator('.followers-camp__choose').is_enabled();page.locator('.followers-camp__choose').click()
   assert page.locator('.followers-camp__choose').is_disabled()
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.screenshot(path=str(OUT/f'roster-{w}-{lang}.png'),full_page=True)
   page.reload();goose=page.locator('.followers-camp__portrait',has_text='Goose Hugger' if lang=='en' else 'Гусь-Обнимусь');goose.click();assert page.locator('.followers-camp__choose').is_disabled()
   page.goto(ORIGIN+'/?fight');page.wait_for_timeout(500)
   assert page.locator('[data-testid="pve-visible-follower"] .goose-companion').count()==1
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.screenshot(path=str(OUT/f'fight-{w}-{lang}.png'),full_page=True)
   seen=turn(page,lang);assert 'commotion' in seen,seen
   assert '520/520' not in page.locator('body').inner_text(), 'Real companion/hero hits must lower enemy HP'
   assert not errors,errors
   results.append({'width':w,'lang':lang,'actions':sorted(seen)});page.close()
 page,errors=prepare(b,390,'ru','fight&boss')
 observed=set()
 for _ in range(3):observed|=turn(page,'ru')
 assert 'dive' in observed,observed
 assert 'hug' in observed,observed
 assert not errors,errors
 page.screenshot(path=str(OUT/'boss-390-ru.png'),full_page=True);page.close()
 page,errors=prepare(b,390,'ru','fight&victory')
 for _ in range(3):turn(page,'ru')
 assert page.locator('.goose-companion').first.get_attribute('data-action')=='victory'
 assert not errors,errors
 page.screenshot(path=str(OUT/'victory-390-ru.png'),full_page=True);page.close()
 page,errors=prepare(b,390,'ru','fight&defeat')
 turn(page,'ru');assert page.locator('.goose-companion').first.get_attribute('data-action')=='defeat'
 assert not errors,errors;page.screenshot(path=str(OUT/'defeat-390-ru.png'),full_page=True);page.close()
 page,errors=prepare(b,390,'ru','fight&trial')
 turn(page,'ru');assert page.evaluate('window.__gooseState().battleStones')==99
 assert not errors,errors;page.close()
 page,errors=prepare(b,390,'ru','locked')
 page.locator('.followers-camp__portrait',has_text='Гусь-Обнимусь').click();assert '30 красных' in page.locator('.followers-camp__detail').inner_text()
 assert page.locator('.followers-camp__choose').is_enabled();page.close()
 b.close()
(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('PASS: production roster and PvE at 320/360/390/430 RU/EN; selection, reload fixture, commotion, boss dive/hug, real victory/defeat, one-stone Trial turn; no JS errors. NOT Android Telegram.')
