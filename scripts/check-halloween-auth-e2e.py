"""Isolated Supabase Auth -> PostgREST -> staged RPC; never targets production."""
import base64, concurrent.futures, hashlib, hmac, json, os, shlex, subprocess, time, urllib.error, urllib.request, uuid

settings = {}
with open('/tmp/halloween-supabase.env', encoding='utf8') as file:
    for line in file:
        if '=' in line:
            key, value = line.strip().split('=', 1)
            if key.isidentifier():
                parsed = shlex.split(value)
                settings[key] = parsed[0] if parsed else ''
api, anon, secret = (settings[name] for name in ('API_URL', 'ANON_KEY', 'JWT_SECRET'))
assert api.startswith('http://127.0.0.1:') and len(secret) >= 32

def request(url, payload=None, token=None, key=None):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    if key: headers['apikey'] = key
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method='POST' if payload is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'{}')

def signup():
    email = f'halloween-{uuid.uuid4()}@example.test'
    status, data = request(api + '/auth/v1/signup', {'email': email, 'password': 'isolated-Only-Password-7832!'}, key=anon)
    assert status == 200 and data.get('access_token') and data.get('user', {}).get('id'), ('signup', status)
    return str(uuid.UUID(data['user']['id'])), data['access_token']

participant, participant_token = signup()
nonparticipant, nonparticipant_token = signup()
assert participant != nonparticipant
network = 'halloween-auth-e2e'
subprocess.run(['docker', 'network', 'create', network], check=True, stdout=subprocess.DEVNULL)
for container in ('halloween-before', 'halloween-after'):
    subprocess.run(['docker', 'network', 'connect', network, container], check=True)
    sql = f"""CREATE ROLE halloween_authenticator LOGIN NOINHERIT;
GRANT anon, authenticated TO halloween_authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
INSERT INTO public.players(id,game_state,gold,vip_level) VALUES
 ('{participant}','{{"activeFollowerId":"follower_6"}}',100,3),
 ('{nonparticipant}','{{"inventory":["keep"]}}',200,2);
INSERT INTO public.territory_halloween_boss_2026_players VALUES
 ('halloween_2026','{participant}',1), ('halloween_2026','{nonparticipant}',0);"""
    subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], input=sql, text=True, check=True, stdout=subprocess.DEVNULL)
    port = '3111' if container.endswith('before') else '3112'
    subprocess.run(['docker', 'run', '-d', '--name', container + '-rest', '--network', network,
                    '-p', '127.0.0.1:' + port + ':3000',
                    '-e', 'PGRST_DB_URI=postgres://halloween_authenticator@' + container + ':5432/postgres',
                    '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon',
                    '-e', 'PGRST_JWT_SECRET=' + secret, 'postgrest/postgrest:v12.2.3'],
                   check=True, stdout=subprocess.DEVNULL)
    for attempt in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:' + port + '/', timeout=1): break
        except (OSError, urllib.error.HTTPError): time.sleep(1)
    else: raise RuntimeError('PostgREST did not start')

before = 'http://127.0.0.1:3111/rpc/territory_halloween_companion_claim_v1'
after = 'http://127.0.0.1:3112/rpc/territory_halloween_companion_claim_v1'
status, data = request(before, {}, participant_token)
assert status == 200 and data['reason'] == 'event_active', ('before deadline',status,data)
status, data = request(after, {}, nonparticipant_token)
assert status == 200 and data['reason'] == 'no_confirmed_hits', ('nonparticipant',status,data)
status, _ = request(after, {})
assert status in (401,403,404), ('anonymous',status)
# JWT cryptography is exercised at PostgREST, not simulated with set_config.
header, payload, signature = participant_token.split('.')
def b64(data): return base64.urlsafe_b64encode(data).rstrip(b'=').decode()
def decode(data): return json.loads(base64.urlsafe_b64decode(data + '=' * (-len(data) % 4)))
expired = decode(payload); expired['exp'] = 1
body = header + '.' + b64(json.dumps(expired,separators=(',',':')).encode())
expired_token = body + '.' + b64(hmac.new(secret.encode(),body.encode(),hashlib.sha256).digest())
for invalid in (expired_token, header + '.' + payload + '.' + ('A' * len(signature))):
    status, _ = request(after, {}, invalid)
    assert status == 401, ('invalid JWT accepted',status)
# A client cannot pass a player ID to the zero-argument owner-scoped RPC.
status, _ = request(after, {'player_id': nonparticipant}, participant_token)
assert status in (400,404), ('foreign player argument accepted',status)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    responses = list(pool.map(lambda _: request(after, {}, participant_token), range(2)))
assert all(status == 200 and data.get('eligible') is True and data.get('level') == 100 for status, data in responses)
assert any(data['alreadyClaimed'] is True for _, data in responses)
status, data = request(after, {}, participant_token)
assert status == 200 and data['alreadyClaimed'] is True
# The private schema is not exposed by PostgREST and the authenticated role has no table privileges.
status, _ = request('http://127.0.0.1:3112/halloween_companion_rewards_2026', {}, participant_token)
assert status in (401,403,404,405), ('direct ledger access',status)
check = f"SELECT count(*) FROM territory_private.halloween_companion_rewards_2026 WHERE player_id='{participant}';"
count = subprocess.check_output(['docker','exec','halloween-after','psql','-X','-At','-U','postgres','-c',check],text=True).strip()
assert count == '1'
print('Supabase Auth issued two independent JWTs; PostgREST verified signatures, expiry, owner-scoped claim, deadline, denial and repeat. Isolated test DB only.')
