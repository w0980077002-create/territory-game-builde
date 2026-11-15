"""Isolated native navigation, potion persistence and test inventory acceptance."""
import os,threading,shutil,json
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];out=root/'artifacts/cave-expedition/evidence'
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
s=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root/'artifacts/cave-expedition')));threading.Thread(target=s.serve_forever,daemon=True).start()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CAVE_BROWSER') or shutil.which('chromium'),args=['--no-sandbox'])
 for width in [320,360,390,430]:
  ctx=b.new_context(viewport={'width':width,'height':720},has_touch=True,is_mobile=True);page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{s.server_port}/test-fixture.html');page.wait_for_function('()=>window.__caveDemo');page.evaluate("localStorage.setItem('territory-player-sentinel','UNCHANGED')")
  page.get_by_role('button',name='В путь').tap();page.evaluate('__caveDemo.step(5)');page.wait_for_timeout(150)
  for name in ['Город','Инвентарь','Герой','Карта','Игры','Клан']:
   page.locator('.cx-native-nav').get_by_role('button',name=name,exact=True).tap();assert page.evaluate('__caveDemo.world.paused')
   before=page.evaluate('__caveDemo.world.time');page.wait_for_timeout(120);assert page.evaluate('__caveDemo.world.time')==before
   if name=='Инвентарь':
    assert page.get_by_test_id('umbra-slot').count()==12 and len(json.loads(page.evaluate("localStorage.getItem('territory_cave_sandbox_v1')"))['loadout'])==12
    page.get_by_test_id('wings-astral').tap();assert page.get_by_test_id('umbra-slot').count()==12;assert page.evaluate('__caveDemo.world.wings')=='astral'
    page.screenshot(path=str(out/f'{width}-inventory.png'))
    page.get_by_role('button',name='Самоцветы',exact=True).tap();page.screenshot(path=str(out/f'{width}-gems.png'));page.get_by_role('button',name='Тёмная энергия',exact=True).tap()
   page.locator('.cx-native-nav').get_by_role('button',name='Бой',exact=True).tap();assert not page.evaluate('__caveDemo.world.paused')
  page.get_by_role('button',name='Настройки',exact=True).tap();page.locator('.cx-panel').get_by_role('button',name='Благословение',exact=True).tap();assert page.get_by_test_id('cave-blessing-slot').count()==3;page.locator('.cx-native-nav').get_by_role('button',name='Бой',exact=True).tap()
  page.get_by_role('button',name='Настройки',exact=True).tap();page.locator('.cx-panel').get_by_role('button',name='Почётные звания',exact=True).tap();assert page.locator('.cx-honor-conditions li').count()==3;page.locator('.cx-native-nav').get_by_role('button',name='Бой',exact=True).tap()
  page.evaluate('__caveDemo.world.hp=400');page.wait_for_timeout(150);page.locator('.cx-belt button').nth(0).tap();assert page.evaluate('__caveDemo.world.belt[0]')==4
  page.get_by_role('button',name='Пауза',exact=True).tap();hp=page.evaluate('__caveDemo.world.hp');page.reload();page.wait_for_function('()=>window.__caveDemo');page.get_by_role('button',name='Продолжить путь').wait_for();assert page.evaluate('__caveDemo.world.hp')==hp;assert page.evaluate('__caveDemo.world.belt[0]')==4
  if width==390:
   page.on('dialog',lambda d:d.accept())
   kit=json.loads(page.evaluate("localStorage.getItem('territory_cave_sandbox_v1')"));kit={'items':len(kit['items']),'enhanceStones':kit['enhanceStones']}
   page.get_by_role('button',name='Продолжить путь').tap();page.get_by_role('button',name='Авто навыков',exact=True).tap()
   for _ in range(300):
    phase=page.evaluate('__caveDemo.world.phase')
    if phase=='VICTORY':break
    if phase=='PORTAL_CHOICE':page.locator('.cx-portals .cx-portal-touch').nth(0).tap()
    page.evaluate('__caveDemo.step(.75)');page.wait_for_timeout(110)
   assert page.evaluate('__caveDemo.world.phase')=='VICTORY'
   stock=lambda:json.loads(page.evaluate("localStorage.getItem('territory_cave_sandbox_v1')"))
   assert len(stock()['items'])==kit['items']+2 and stock()['enhanceStones']==kit['enhanceStones']+15
   page.get_by_role('button',name='Настройки',exact=True).tap();page.locator('.cx-panel').get_by_role('button',name='Почётные звания',exact=True).tap();page.get_by_role('button',name='Получить · +10 синих',exact=True).tap();assert stock()['playtestBlueDiamonds']==10;page.locator('.cx-native-nav').get_by_role('button',name='Бой',exact=True).tap()
   page.get_by_role('button',name='Открыть добычу').tap();page.get_by_test_id('umbra-item').first.tap();page.get_by_test_id('umbra-equip').tap()
   assert len(stock()['loadout'])==12
   stones=stock()['enhanceStones'];page.get_by_test_id('umbra-enhance-all').tap();assert stock()['enhanceStones']<stones and max(i['enhance'] for i in stock()['items'])>0
   count=len(stock()['items']);stones=stock()['enhanceStones'];page.get_by_test_id('umbra-item').first.tap();page.get_by_test_id('umbra-dismantle').tap();assert len(stock()['items'])==count-1 and stock()['enhanceStones']>stones
   page.screenshot(path=str(out/'390-earned-gear.png'))
   before=stock();page.reload();page.wait_for_function('()=>window.__caveDemo');page.wait_for_timeout(300);assert stock()==before,'Victory reload never grants twice'
   page.get_by_role('button',name='Повторить забег').tap();assert page.evaluate('__caveDemo.world.maxHp>900 || __caveDemo.world.attackBonus>0 || __caveDemo.world.defenseBonus>0') or any(i['main']['stat'] not in ['hp','attack','defense'] for i in before['items'])
  assert page.evaluate("localStorage.getItem('territory-player-sentinel')")=='UNCHANGED';assert not errors,errors
  print(f'PASS {width}: seven native destinations, twelve dark slots, gems, paused panels, consumed potion restored, player sentinel preserved',flush=True);ctx.close()
 b.close()
s.shutdown()
