"""Real admin component with an intercepted, synthetic API; no real credentials or DB."""
import json, os, shutil, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
 def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
player = '10000000-0000-4000-8000-000000000001'
with sync_playwright() as p:
 browser = p.chromium.launch(executable_path=shutil.which('chromium') or None, args=['--no-sandbox'])
 page = browser.new_page(viewport={'width': 320, 'height': 760})
 page.add_init_script("localStorage.setItem('territory_admin_token', String(Date.now()+3600000)+'.fixture')")
 requests = []
 def route_handler(route):
  req = route.request
  if req.method == 'OPTIONS':
   route.fulfill(status=204, headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'*'}); return
  body = req.post_data_json
  if body['action'] == 'runes_player':
   route.fulfill(json={'playerId':player,'owned':[{'runeId':'shield_wall_r1','level':2}]},headers={'Access-Control-Allow-Origin':'*'}); return
  assert body['action'] == 'runes_set_level'
  requests.append(body)
  if len(requests) == 1:
   route.abort('failed'); return
  route.fulfill(json={'playerId':player,'runeId':body['runeId'],'level':body['level'],'previousLevel':2,'operationId':body['requestId']},headers={'Access-Control-Allow-Origin':'*'})
 page.route('http://127.0.0.1:1/**', route_handler)
 page.goto(f'http://127.0.0.1:{server.server_port}/territory-admin-runes.html')
 page.get_by_text('Текущий уровень: 2').wait_for()
 page.get_by_label('Новый уровень (0–3)').fill('3')
 page.get_by_label('Причина').fill('fixture grant')
 page.get_by_role('button', name='Установить уровень').click()
 page.get_by_role('button', name='Повторить запрос').wait_for()
 page.reload()
 page.get_by_role('button', name='Повторить запрос').click()
 page.get_by_role('button', name='Установить уровень').wait_for()
 assert len(requests)==2 and {k:v for k,v in requests[0].items() if k != 'token'} == {k:v for k,v in requests[1].items() if k != 'token'}
 assert requests[0]['level']==3 and requests[0]['playerId']==player
 assert page.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('territory_rune_admin_pending_')).length") == 0
 browser.close()
server.shutdown()
print('Admin rune UI: synthetic status, request loss, reload, same UUID retry and receipt PASS')
