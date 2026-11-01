"""Real local admin-api HTTP integration. Uses only the throwaway Supabase stack."""
import hashlib, json, os, pathlib, shlex, shutil, signal, subprocess, time, urllib.error, urllib.request, uuid

settings = {}
for line in pathlib.Path('/tmp/halloween-supabase.env').read_text().splitlines():
    if '=' in line:
        key, value = line.split('=', 1)
        if key.isidentifier():
            parts = shlex.split(value)
            settings[key] = parts[0] if parts else ''
api, anon, db_url = (settings[k] for k in ('API_URL','ANON_KEY','DB_URL'))
assert api.startswith('http://127.0.0.1:') and ('127.0.0.1' in db_url or 'localhost' in db_url)
project = pathlib.Path('/tmp/halloween-auth-project')
root = pathlib.Path.cwd()
function_dir = project / 'supabase/functions/admin-api'
function_dir.mkdir(parents=True,exist_ok=True)
shutil.copyfile(root / 'supabase/functions/admin-api/index.ts', function_dir / 'index.ts')
with (project / 'supabase/config.toml').open('a') as file:
    file.write('\n[functions.admin-api]\nverify_jwt = true\n')
password = 'isolated-owner-Password-7832'
salt = '00112233445566778899aabbccddeeff'
verifier = hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),150000).hex()
fixture = f"""
CREATE SCHEMA IF NOT EXISTS territory_private;
CREATE TABLE public.players (id uuid PRIMARY KEY,game_state jsonb,gold int,vip_level int);
CREATE TABLE public.territory_halloween_boss_2026 (id text PRIMARY KEY, ends_at timestamptz NOT NULL);
CREATE TABLE public.territory_halloween_boss_2026_players (event_id text,player_id uuid,total_hits int, PRIMARY KEY(event_id,player_id));
CREATE TABLE public.admin_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,action text NOT NULL,details jsonb DEFAULT '{{}}',created_at timestamptz DEFAULT now());
GRANT ALL ON public.admin_audit_log TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
CREATE OR REPLACE FUNCTION public.territory_admin_credential_v2() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
SELECT jsonb_build_object('salt','{salt}','verifier','{verifier}','version',1) $$;
REVOKE ALL ON FUNCTION public.territory_admin_credential_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_credential_v2() TO service_role;
INSERT INTO public.players VALUES ('00000000-0000-0000-0000-000000000001','{{"activeFollowerId":"follower_6"}}',42,3);
INSERT INTO public.territory_halloween_boss_2026 VALUES ('halloween_2026','2020-01-01');
INSERT INTO public.territory_halloween_boss_2026_players VALUES ('halloween_2026','00000000-0000-0000-0000-000000000001',1);
"""
def sql(text):
    result = subprocess.run(['psql',db_url,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],input=text,text=True,capture_output=True)
    if result.returncode: raise RuntimeError('Isolated PostgreSQL fixture failed: ' + result.stderr[-1500:])
    return result.stdout.strip()
sql(fixture)
# Edge-specific test clock: only this disposable DB changes the fixed literal.
# Exact unmodified staged SQL and both deadlines are tested by the PG17 job.
staged = (root / 'supabase/staged/halloween_companion_reward_2026.sql').read_text().replace('2026-11-03 00:00:00+00','2020-01-01 00:00:00+00')
sql(staged + "\nNOTIFY pgrst, 'reload schema';")

def call(body):
    req = urllib.request.Request(api + '/functions/v1/admin-api',data=json.dumps(body).encode(),
        headers={'Content-Type':'application/json','Authorization':'Bearer '+anon,'apikey':anon},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=20) as response: return response.status,json.load(response)
    except urllib.error.HTTPError as error: return error.code,json.loads(error.read() or b'{}')

def serve(enabled):
    envfile=pathlib.Path('/tmp/halloween-edge-test.env')
    envfile.write_text('HALLOWEEN_COMPANION_OPERATOR_ENABLED=' + ('true' if enabled else 'false') + '\n')
    log=open('/tmp/halloween-edge-test.log','ab')
    proc=subprocess.Popen(['supabase','functions','serve','admin-api','--env-file',str(envfile)],cwd=project,stdout=log,stderr=log)
    for _ in range(120):
        if proc.poll() is not None: raise RuntimeError('isolated Edge server stopped unexpectedly')
        try:
            code,_=call({'action':'verify','token':'invalid'})
            if code == 401: return proc,log
        except (OSError,urllib.error.URLError,ValueError): pass
        time.sleep(1)
    raise RuntimeError('isolated Edge server did not become ready')

def stop(proc,log):
    proc.send_signal(signal.SIGINT)
    try: proc.wait(timeout=30)
    except subprocess.TimeoutExpired: proc.kill();proc.wait()
    log.close()
    # `functions serve` can leave its local worker alive after the CLI exits;
    # remove only this disposable test project's worker before changing flags.
    names = subprocess.check_output(['docker','ps','-a','--format','{{.Names}}'], text=True).splitlines()
    for name in names:
        if name == 'supabase_edge_runtime_halloween-auth-project':
            subprocess.run(['docker','rm','-f',name],check=True,stdout=subprocess.DEVNULL)

proc,log=serve(False)
try:
    code,_=call({'action':'halloween_reward_status'})
    assert code == 401, ('missing owner token',code)
    code,_=call({'action':'halloween_reward_status','token':'invalid'})
    assert code == 401, ('invalid owner token',code)
    code,login=call({'action':'login','username':'owner','password':password})
    assert code == 200 and login.get('token'), ('owner login',code)
    owner=login['token']; reqid=str(uuid.uuid4())
    code,_=call({'action':'halloween_reward_bulk','token':owner,'requestId':reqid,'eligible':0,'digest':'d41d8cd98f00b204e9800998ecf8427e'})
    assert code == 503 and sql('select count(*) from territory_private.halloween_companion_attempts_2026') == '0', 'disabled operator must not issue grant'
finally: stop(proc,log)

proc,log=serve(True)
try:
    code,preview=call({'action':'halloween_reward_status','token':owner})
    assert code == 200 and preview['snapshot']['eligible'] == 1
    snap=preview['snapshot']; reqid=str(uuid.uuid4())
    code,_=call({'action':'halloween_reward_bulk','token':owner,'requestId':reqid,'eligible':0,'digest':snap['digest']})
    assert code == 503
    code,after_failure=call({'action':'halloween_reward_status','token':owner})
    assert code == 200 and after_failure['audit']['failed'] == 1 and after_failure['audit']['lastError'] == 'snapshot_changed', ('audit after refused bulk', code, after_failure)
    reqid=str(uuid.uuid4()); payload={'action':'halloween_reward_bulk','token':owner,'requestId':reqid,'eligible':snap['eligible'],'digest':snap['digest']}
    code,receipt=call(payload)
    assert code == 200 and receipt['inserted'] == 1 and receipt['alreadyProcessed'] is False
    code,repeat=call(payload)
    assert code == 200 and repeat['alreadyProcessed'] is True
    code,status=call({'action':'halloween_reward_status','token':owner})
    assert code == 200 and status['snapshot']['pending'] == 0 and status['snapshot']['granted'] == 1
    assert status['audit']['failed'] == 1 and status['audit']['unfinished'] == 0
    assert '00000000-0000-0000-0000-000000000001' not in json.dumps(status)
    assert sql('select count(*) from territory_private.halloween_companion_rewards_2026') == '1'
    assert sql("select gold || ':' || vip_level || ':' || (game_state->>'activeFollowerId') from public.players") == '42:3:follower_6'
finally: stop(proc,log)
print('Real isolated admin Edge HTTP: owner authentication, disabled flag, failed/successful audited bulk, repeat and reconcile passed. Interrupted-call and real game client remain separate gates.')
