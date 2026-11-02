"""Real Supabase Auth-issued JWT -> PostgREST -> protected Halloween top-20 mail helmet claim.
Disposable PostgreSQL17 halloween_bonus database only; no production access.
"""
import json, shlex, subprocess, time, urllib.error, urllib.request, uuid

settings = {}
with open('/tmp/halloween-supabase.env', encoding='utf8') as f:
    for line in f:
        if '=' in line:
            key, value = line.strip().split('=', 1)
            if key.isidentifier():
                parts = shlex.split(value)
                settings[key] = parts[0] if parts else ''
api, anon = (settings[k] for k in ('API_URL','ANON_KEY'))

def call(url, payload=None, token=None):
    headers={'Content-Type':'application/json','apikey':anon}
    if token: headers['Authorization']='Bearer '+token
    data=None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request(url,data=data,headers=headers,method='POST' if payload is not None else 'GET')
    try:
        with urllib.request.urlopen(req,timeout=20) as response:
            return response.status,json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as err:
        return err.code,json.loads(err.read() or b'{}')

def signup():
    status,data=call(api+'/auth/v1/signup',{'email':f'pumpkin-{uuid.uuid4()}@example.test','password':'isolated-Test-Pass-7832!'})
    assert status==200 and data.get('access_token') and data.get('user',{}).get('id'),(status,data)
    return str(uuid.UUID(data['user']['id'])),data['access_token']

winner,winner_token=signup()
outsider,outsider_token=signup()
assert winner!=outsider

sql="""CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$jwt$SELECT COALESCE(nullif(current_setting('request.jwt.claim.sub',true),''), NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$jwt$;
GRANT USAGE ON SCHEMA public TO authenticated,anon;
DELETE FROM territory_private.halloween_top20_bonus_2026 WHERE place=4;
DELETE FROM public.admin_grants WHERE player_id='00000000-0000-0000-0000-000000000004';
"""
base_state=json.dumps({
    'player':{'gold':200,'gems':0,'redGems':0,'equipped':{}},
    'inventory':[],'battleStones':3,'forgeMaterials':0,'forgeMaterialBatches':[],
    'followers':[{'id':'follower_6','name':'Боевая корова'}]
},ensure_ascii=False).replace("'","''")
for uid in (winner,outsider):
    sql+=f"INSERT INTO public.players(id,game_state,gold,gems,forge_materials,vip_level) VALUES ('{uid}','{base_state}'::jsonb,200,0,0,2);\\n".replace('\\n','\n')
sql+=f"""
WITH grant_row AS (
 INSERT INTO public.admin_grants(player_id,kind,subject,body,payload)
 VALUES ('{winner}','mail','Раритетная тыква','Памятный шлем',
 '{{"gold":1500,"gems":75,"stones":3,"items":{{"halloween_horned_pumpkin_2026":1}}}}'::jsonb)
 RETURNING id,player_id,payload
)
INSERT INTO territory_private.halloween_top20_bonus_2026(event_id,player_id,place,mail_id,payload)
SELECT 'halloween_2026',player_id,4,id,payload FROM grant_row;
"""
subprocess.run(['docker','exec','-i','halloween-after','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','halloween_bonus'],input=sql,text=True,check=True,stdout=subprocess.DEVNULL)
status,jwks=call(api+'/auth/v1/.well-known/jwks.json')
assert status==200 and jwks.get('keys'),('missing jwks',status)
# Auth-issued RSA/EC JWTs are verified cryptographically by PostgREST.
url='http://127.0.0.1:3113/rpc/territory_admin_claim_grant_v2'
name='halloween-pumpkin-bonus-rest'
subprocess.run(['docker','run','-d','--name',name,'--network','halloween-auth-e2e','-p','127.0.0.1:3113:3000',
 '-e','PGRST_DB_URI=postgres://halloween_authenticator@halloween-after:5432/halloween_bonus',
 '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon',
 '-e','PGRST_JWT_SECRET='+json.dumps(jwks,separators=(',',':')),
 'postgrest/postgrest:v12.2.3'],check=True,stdout=subprocess.DEVNULL)
for attempt in range(50):
    try:
        with urllib.request.urlopen('http://127.0.0.1:3113/',timeout=2): break
    except urllib.error.HTTPError as err:
        if err.code<500: break
        time.sleep(.4)
    except OSError: time.sleep(.4)
else: raise RuntimeError('bonus PostgREST unavailable')
fetch=f"SELECT id FROM public.admin_grants WHERE player_id='{winner}' AND kind='mail';"
mail_id=subprocess.check_output(['docker','exec','halloween-after','psql','-X','-At','-U','postgres','-d','halloween_bonus','-c',fetch],text=True).strip()
assert mail_id
status,_=call(url,{'p_id':mail_id})
assert status in (401,403,404),(status,'anonymous claimed')
status,data=call(url,{'p_id':mail_id},outsider_token)
assert status>=400,(status,'nonwinner claimed',data)
status,data=call(url,{'p_id':mail_id},winner_token)
assert status==200 and data.get('success') is True and data.get('replayed') is False,(status,data)
status,data=call(url,{'p_id':mail_id},winner_token)
assert status==200 and data.get('replayed') is True,(status,data)
check=f"""SELECT json_build_object(
  'count',(SELECT count(*) FROM jsonb_array_elements(game_state->'inventory')
    WHERE value#>>'{{equipment,id}}'='halloween_horned_pumpkin_2026'),
  'defense',game_state#>>'{{inventory,0,equipment,defense}}',
  'cow',game_state#>>'{{followers,0,id}}',
  'gold',gold,'gems',gems,'vip',vip_level)::text FROM public.players WHERE id='{winner}';"""
v=json.loads(subprocess.check_output(['docker','exec','halloween-after','psql','-X','-At','-U','postgres','-d','halloween_bonus','-c',check],text=True))
assert v=={'count':1,'defense':'6','cow':'follower_6','gold':1700,'gems':75,'vip':2},v
check=f"SELECT game_state->'inventory' FROM public.players WHERE id='{outsider}';"
out=subprocess.check_output(['docker','exec','halloween-after','psql','-X','-At','-U','postgres','-d','halloween_bonus','-c',check],text=True).strip()
assert json.loads(out)==[],out
print('Halloween TOP20 helmet mail: signed Auth JWT, owner-only claim, outsider/anonymous denial and exact-once inventory credit: PASS')
