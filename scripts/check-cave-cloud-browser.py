"""Existing unified scene + synthetic transport; never connects to player accounts."""
import json, threading, shutil, os
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/cave-expedition/cloud-evidence'; OUT.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT/'artifacts/cave-expedition')))
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}/cloud-fixture.html'
KEY='territory_cave_playtest_checkpoint_v1:fixture-account'
BANK='territory_cave_sandbox_v1:fixture-account'
def world(p): return p.evaluate('__caveDemo.world')
def ledger(p): return p.evaluate('JSON.parse(localStorage.getItem("cave-fixture-server"))')
def button(p,ru,en,lang): return p.get_by_role('button',name=en if lang=='en' else ru,exact=True)
def ready(p): p.wait_for_function('() => window.__caveDemo && window.__caveCloud.calls.includes("status")'); p.wait_for_timeout(150)
def tick(p,seconds=1): p.evaluate('(s)=>__caveDemo.step(s)',seconds); p.wait_for_timeout(20)
def travel(p,phase):
 for _ in range(160):
  if world(p)['phase']==phase: return
  tick(p,1)
 raise AssertionError((phase,world(p)['phase']))
def run_floor(p,lang,reloads=False):
 p.evaluate('__caveDemo.world.auto=true;__caveDemo.world.autoPotions=true')
 phases=set()
 for section in range(4):
  travel(p,'PORTAL_CHOICE')
  if reloads and section==1:
   p.reload();ready(p); assert world(p)['phase']=='PORTAL_CHOICE'; assert world(p)['paused']; button(p,'Продолжить путь','Continue',lang).click()
  p.locator('.cx-portals button').nth(section%3).click()
  # Capture one real mid-wave checkpoint and restore it, without skipping enemies.
  if reloads and section==0:
   travel(p,'FIGHT'); before=world(p); p.reload();ready(p); after=world(p)
   assert after['paused'] and after['kills']==before['kills']; button(p,'Продолжить путь','Continue',lang).click()
  for _ in range(700):
   w=world(p)
   if w['phase']=='BOSS':
    if not phases: p.screenshot(path=str(OUT/f'{lang}-{p.viewport_size["width"]}-boss.png'),animations='disabled')
    phases.add(w['bossPhase'])
    if reloads and len(phases)==1:
     before=w; p.reload();ready(p); assert world(p)['bossSpawned'] and world(p)['paused']; button(p,'Продолжить путь','Continue',lang).click(); reloads=False
   if w['phase'] in ['PORTAL_CHOICE','VICTORY','DEFEAT']: break
   tick(p,2)
  assert world(p)['phase']!='DEFEAT', 'real auto fight should be winnable for fixture hero'
 assert world(p)['phase']=='VICTORY', world(p)['phase']
 assert phases=={1,2,3},phases
 assert world(p)['kills']==sum(9+i%3 for i in range(4))+1
reports=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path=os.getenv('CAVE_BROWSER') or shutil.which('chromium') or shutil.which('chromium-browser'),args=['--no-sandbox'])
 for lang in ['ru','en']:
  for width in [320,360,390,430]:
   if os.getenv('CAVE_CASE') and os.getenv('CAVE_CASE')!=f'{lang}-{width}': continue
   ctx=browser.new_context(viewport={'width':width,'height':740},is_mobile=True,has_touch=True)
   p=ctx.new_page(); errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
   p.goto(URL+'?lang='+lang);ready(p)
   assert p.evaluate('!localStorage.getItem("'+BANK+'")'),'no fake starter kit in an account'
   for ru,en in [('Тёмных камней','Dark Stones')]:
    p.locator('.cx-cloud-progress button').first.click(); assert p.locator('.cx-panel').is_visible(); button(p,'← В бой','← To battle',lang).click()
   for ru,en in [('Этажи пещеры','Cave floors'),('Снаряжение','Equipment'),('Благословения','Blessings'),('Фонд','Fund')]:
    button(p,ru,en,lang).click(); assert p.locator('.cx-panel').is_visible()
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
    p.wait_for_timeout(250); p.screenshot(path=str(OUT/f'{lang}-{width}-{en.split()[0]}.png'),animations='disabled')
    button(p,'← В бой','← To battle',lang).click()
   if width==320:
    p.set_viewport_size({'width':320,'height':568})
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
    p.screenshot(path=str(OUT/f'{lang}-320-short-entrance.png'),animations='disabled')
    p.set_viewport_size({'width':width,'height':740})
   p.evaluate('__caveCloud.failStartAfterCommit=true')
   button(p,'В путь →','Set out →',lang).click(); p.wait_for_timeout(200)
   assert ledger(p)['dark_stones']==49
   p.reload();ready(p); assert world(p)['paused']; assert ledger(p)['dark_stones']==49
   button(p,'Продолжить путь','Continue',lang).click()
   p.wait_for_timeout(1100)
   assert p.locator('[aria-label="'+('Уровень героя 23' if lang=='ru' else 'Hero level 23')+'"]').count()==1
   assert world(p)['maxHp']==1620 and world(p)['attackBonus']==60 and world(p)['defenseBonus']==45
   p.evaluate('__caveCloud.failFinishAfterCommit=true')
   run_floor(p,lang,reloads=width==320 and lang=='ru')
   p.wait_for_timeout(300)
   assert ledger(p)['completed_stage']==1
   p.reload();ready(p);p.wait_for_timeout(300)
   assert ledger(p)['dark_stones']==49 and ledger(p)['unlocked_stage']==2
   bank=p.evaluate('JSON.parse(localStorage.getItem("'+BANK+'"))');assert bank['playtestWins']==1
   p.reload();ready(p);p.wait_for_timeout(300)
   assert p.evaluate('JSON.parse(localStorage.getItem("'+BANK+'")).playtestWins')==1
   p.screenshot(path=str(OUT/f'{lang}-{width}-victory.png'))
   button(p,'К входному порталу','Back to entrance',lang).click()
   button(p,'Этажи пещеры','Cave floors',lang).click();p.locator('.cx-floor-picker button').nth(0).click()
   run_floor(p,lang);p.wait_for_timeout(250)
   assert ledger(p)['completed_stage']==1 and ledger(p)['unlocked_stage']==2 and ledger(p)['dark_stones']==48
   assert p.evaluate('JSON.parse(localStorage.getItem("'+BANK+'")).playtestWins')==2
   # An offline exit journals the loss and keeps the checkpoint until retry.
   button(p,'К входному порталу','Back to entrance',lang).click()
   button(p,'В путь →','Set out →',lang).click();p.wait_for_timeout(160)
   p.evaluate('__caveCloud.failFinishBeforeCommit=true')
   button(p,'Пауза','Pause',lang).click();button(p,'К входному порталу','Back to entrance',lang).click();p.wait_for_timeout(180)
   assert world(p)['phase']=='DEFEAT' and ledger(p)['dark_stones']==47
   p.reload();ready(p);p.wait_for_timeout(180)
   assert ledger(p)['dark_stones']==48 and world(p)['phase']=='DEFEAT'
   # New UUID after a confirmed loss, a burst of taps must debit once.
   button(p,'К входному порталу','Back to entrance',lang).click()
   p.locator('.cx-lobby .cx-primary').evaluate('e=>{e.click();e.click();e.click()}');p.wait_for_timeout(180)
   assert ledger(p)['dark_stones']==47
   # A second device has no local checkpoint and sees the same active server run.
   second=ctx.new_page();second.on('dialog',lambda d:d.accept())
   second.add_init_script('''{const original=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k==='''+json.dumps(KEY)+''')return null;return original.call(this,k)}}''')
   second.goto(URL+'?lang='+lang);ready(second)
   button(second,'Закрыть старый забег · вернуть камень','Close old run · refund Stone',lang).click();second.wait_for_timeout(180)
   assert ledger(second)['dark_stones']==48
   second.close()
   button(p,'Пауза','Pause',lang).click();button(p,'К входному порталу','Back to entrance',lang).click();p.wait_for_timeout(180)
   assert ledger(p)['dark_stones']==48,'first receipt wins; no repeated refund'
   if lang=='ru' and width==320:
    # A late ACK from a screen closed by SPA navigation cannot overwrite a later run's checkpoint.
    if world(p)['phase']!='LOBBY': button(p,'К входному порталу','Back to entrance',lang).click()
    button(p,'В путь →','Set out →',lang).click();p.wait_for_timeout(150)
    p.evaluate('__caveCloud.finishDelay=800')
    button(p,'Пауза','Pause',lang).click();button(p,'К входному порталу','Back to entrance',lang).click()
    p.wait_for_timeout(100);p.evaluate('__caveDemo.unmount()')
    p.evaluate('(key)=>localStorage.setItem(key,"newer-checkpoint-sentinel")',KEY)
    p.wait_for_timeout(950)
    assert p.evaluate('(key)=>localStorage.getItem(key)',KEY)=='newer-checkpoint-sentinel'
   assert not errors,errors
   reports.append({'language':lang,'width':width,'full_floor':True,'boss_phases':[1,2,3],'lost_start_response':True,'lost_finish_response':True,'repeat_farm':True,'offline_exit':True,'double_tap':True,'second_device':True,'no_page_errors':True})
   print('PASS',lang,width,'real full floor, replay, lost start/finish response, reload, floor farm, windows, hero stats',flush=True)
   ctx.close()
 browser.close()
server.shutdown()
(OUT/'report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
