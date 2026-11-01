"""Actual App + saveCloudSave against isolated Supabase. Browser contexts are not physical devices."""
import base64, json, os, pathlib, re, shlex, subprocess, time, urllib.request, uuid
from playwright.sync_api import sync_playwright
settings={}
for line in pathlib.Path('/tmp/halloween-supabase.env').read_text().splitlines():
    if '=' in line:
        key,value=line.split('=',1)
        if key.isidentifier():
            parts=shlex.split(value); settings[key]=parts[0] if parts else ''
api,anon,db_url=(settings[k] for k in ('API_URL','ANON_KEY','DB_URL'))
assert api.startswith('http://127.0.0.1:') and ('127.0.0.1' in db_url or 'localhost' in db_url)
def sql(text):
    result=subprocess.run(['psql',db_url,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],input=text,text=True,capture_output=True)
    if result.returncode: raise RuntimeError('isolated DB test setup failed: '+result.stderr[-1000:])
    return result.stdout.strip()
sql('''ALTER TABLE public.players
 ADD COLUMN gems integer NOT NULL DEFAULT 10, ADD COLUMN telegram_id bigint,
 ADD COLUMN photo_url text, ADD COLUMN display_name text DEFAULT 'Тестовый герой',
 ADD COLUMN arena_rating int DEFAULT 1000, ADD COLUMN arena_wins int DEFAULT 0, ADD COLUMN arena_losses int DEFAULT 0,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN level int DEFAULT 1, ADD COLUMN xp int DEFAULT 0,
 ADD COLUMN energy int DEFAULT 20, ADD COLUMN max_energy int DEFAULT 20, ADD COLUMN current_chapter int DEFAULT 1,
 ADD COLUMN chapter_wins int DEFAULT 0, ADD COLUMN total_battles_won int DEFAULT 0, ADD COLUMN total_bosses_defeated int DEFAULT 0,
 ADD COLUMN forge_materials int DEFAULT 0, ADD COLUMN attack int DEFAULT 20, ADD COLUMN defense int DEFAULT 5,
 ADD COLUMN max_hp int DEFAULT 100, ADD COLUMN crit_chance int DEFAULT 5;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON public.players TO authenticated;
CREATE POLICY halloween_test_read ON public.players FOR SELECT TO authenticated USING (id=auth.uid());
CREATE POLICY halloween_test_write ON public.players FOR UPDATE TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());
NOTIFY pgrst, 'reload schema';''')
def signup():
    email=f'client-{uuid.uuid4()}@example.test'; password='Local-Game-Test-8942!'
    body=json.dumps({'email':email,'password':password}).encode()
    req=urllib.request.Request(api+'/auth/v1/signup',data=body,headers={'Content-Type':'application/json','apikey':anon},method='POST')
    with urllib.request.urlopen(req,timeout=20) as response: data=json.load(response)
    return str(uuid.UUID(data['user']['id'])),email,password
participant,email,password=signup(); nonparticipant,other_email,other_password=signup()
env=os.environ.copy();env.update({'VITE_SUPABASE_URL':api,'VITE_SUPABASE_ANON_KEY':anon,'VITE_TERRITORY_V1_SERVER_COMBAT':'false','VITE_TERRITORY_PROFESSIONS_STAGE8':'false'})
log=open('/tmp/halloween-real-client-vite.log','w')
server=subprocess.Popen(['npm','run','dev','--','--host','127.0.0.1','--port','4173','--strictPort'],env=env,stdout=log,stderr=log,start_new_session=True)
try:
    url='http://127.0.0.1:4173/territory-game-builde/'
    for _ in range(60):
        try:
            with urllib.request.urlopen(url,timeout=1): break
        except OSError: time.sleep(1)
    else: raise RuntimeError('isolated game server did not start')
    with sync_playwright() as p:
        browser=p.chromium.launch(args=['--no-sandbox'])
        contexts=[browser.new_context(viewport={'width':360,'height':780}) for _ in range(3)]
        a,b,c=[context.new_page() for context in contexts]
        errors=[]; b.on('console',lambda message: errors.append(message.text))
        a.goto(url)
        seed=a.evaluate('''async () => {
          const {createInitialGame}=await import('/territory-game-builde/src/game/engine.ts');
          const s=createInitialGame(); s.player.level=50; s.currentChapter=5; s.activeFollowerId='follower_6';
          s.followers=s.followers.map(f=>({...f,unlocked:true}));
          s.player.equipped.weapon={id:'kept_weapon',slot:'weapon',name:'Учебный меч',icon:'⚔️',rarity:'common',level:1,attack:2};
          s.inventory.push({id:'kept_material',name:'Материал',icon:'🪨',type:'material',rarity:'common',qty:2});
          return s;
        }''')
        encoded=base64.b64encode(json.dumps(seed,ensure_ascii=False).encode()).decode()
        for uid,hits in ((participant,1),(nonparticipant,0)):
            sql(f"INSERT INTO public.players(id,game_state,gold,gems,vip_level,level) VALUES ('{uid}',convert_from(decode('{encoded}','base64'),'utf8')::jsonb,100,10,3,50); INSERT INTO public.territory_halloween_boss_2026_players VALUES ('halloween_2026','{uid}',{hits});")
        def login(page,user,secret):
            page.goto(url)
            result=page.evaluate('''async ([email,password]) => {
              const {supabase}=await import('/territory-game-builde/src/game/supabase.ts');
              const {error}=await supabase.auth.signInWithPassword({email,password});return error?.message ?? null;
            }''',[user,secret])
            assert result is None, ('isolated auth sign-in failed',result)
            page.reload(); page.locator('nav.territory-nav').wait_for(timeout=30000)
        def camp(page):
            page.locator('nav.territory-nav button').nth(1).click()
            page.get_by_role('tab',name='Спутники').click()
            panel=page.locator('[data-testid="followers-panel"]');panel.wait_for(timeout=15000);return panel
        def read_state():
            return json.loads(sql(f"select game_state::text from public.players where id='{participant}'"))
        def wait_for(predicate,seconds=20):
            for _ in range(seconds*4):
                value=read_state()
                if predicate(value): return value
                time.sleep(.25)
            raise AssertionError('server state did not reach expected condition')
        login(a,email,password)
        panel=camp(a)
        assert 'Боевая корова' in panel.locator('.followers-camp__active').inner_text()
        panel.locator('.followers-camp__portrait').last.click()
        panel.locator('.followers-camp__choose').wait_for(state='visible',timeout=20000)
        assert '100/100' in panel.locator('.followers-camp__detail').inner_text()
        wait_for(lambda s:s.get('halloweenCompanionVerified') is True)
        login(b,email,password); panel_b=camp(b)
        assert 'Боевая корова' in panel_b.locator('.followers-camp__active').inner_text()
        time.sleep(2)
        # Refresh A after B has installed its entitlement; B is now the stale client.
        a.reload();a.locator('nav.territory-nav').wait_for(timeout=30000);panel=camp(a)
        panel.locator('.followers-camp__portrait').last.click()
        wait_for(lambda s:s.get('halloweenCompanionVerified') is True)
        time.sleep(2)
        cow_before=next(f for f in read_state()['followers'] if f['id']=='follower_6')
        panel.locator('.followers-camp__choose').click()
        state=wait_for(lambda s:s.get('activeFollowerId')=='follower_pumpkin_witch_2026')
        assert next(f for f in state['followers'] if f['id']=='follower_6')==cow_before
        assert state['player']['gold']==100 and state['player']['gems']==10
        assert state['player']['equipped']['weapon']['id']=='kept_weapon'
        assert any(x['id']=='kept_material' and x['qty']==2 for x in state['inventory'])
        assert sql(f"select vip_level from public.players where id='{participant}'")=='3'
        # B's real saveCloudSave is based on the older row revision and must
        # fail closed instead of overwriting A's new selection and inventory.
        panel_b.locator('.followers-camp__portrait').first.click()
        panel_b.locator('.followers-camp__choose').click()
        # Inspect the actual cloud module rather than relying on a warning that
        # might have been emitted by an earlier autosave in the same session.
        result=b.evaluate("""async (id) => {
          const cloud=await import('/territory-game-builde/src/game/cloud.ts');
          const {useGame}=await import('/territory-game-builde/src/game/actions.ts');
          const alreadyBlocked=cloud.saveBlocked.has(id);
          const saved=await cloud.saveCloudSave(id,useGame.get());
          return {alreadyBlocked,saved,blockedAfter:cloud.saveBlocked.has(id)};
        }""",participant)
        assert result['saved'] is False and result['blockedAfter'] is True, ('expected real stale-save fence',result,[line for line in errors if 'Save' in line or 'snapshot' in line])
        assert read_state()['activeFollowerId']=='follower_pumpkin_witch_2026'
        contexts[0].set_offline(True);time.sleep(.5);contexts[0].set_offline(False)
        a.reload();a.locator('nav.territory-nav').wait_for(timeout=30000);panel=camp(a)
        assert 'Тыквенная ведьма' in panel.locator('.followers-camp__active').inner_text()
        assert sql(f"select count(*) from territory_private.halloween_companion_rewards_2026 where player_id='{participant}'")=='1'
        login(c,other_email,other_password);panel_c=camp(c);panel_c.locator('.followers-camp__portrait').last.click()
        assert panel_c.locator('.followers-camp__availability--locked').is_visible()
        assert panel_c.locator('.followers-camp__choose').count()==0
        assert sql(f"select count(*) from territory_private.halloween_companion_rewards_2026 where player_id='{nonparticipant}'")=='0'
        pathlib.Path('/tmp/halloween-real-client-evidence').mkdir(exist_ok=True)
        panel.screenshot(path='/tmp/halloween-real-client-evidence/participant.png')
        panel_c.screenshot(path='/tmp/halloween-real-client-evidence/nonparticipant.png')
        # Exercise the actual campaign route after the verified companion has
        # survived reload. The DOM observer records the real PvE pose event;
        # this is not a synthetic motion-fixture button.
        a.locator('nav.territory-nav button').nth(3).click()
        a.locator('.journey-encounter button').first.click(timeout=15000)
        a.locator('.pumpkin-witch').wait_for(timeout=15000)
        a.evaluate('''() => { window.__witchAttacks=0; new MutationObserver(() => {
          if (document.querySelector('.pumpkin-witch__action-pose[src$="attack.webp"]')) window.__witchAttacks++;
        }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']}); }''')
        a.get_by_role('button',name=re.compile('Авто')).click()
        a.locator('[data-testid="pve-result-screen"]').wait_for(timeout=60000)
        assert a.evaluate('window.__witchAttacks') > 0, 'actual PvE did not render the companion strike'
        a.locator('[data-testid="pve-result-screen"]').screenshot(path='/tmp/halloween-real-client-evidence/pve-result.png')
        browser.close()
finally:
    os.killpg(server.pid,15)
    try: server.wait(timeout=10)
    except subprocess.TimeoutExpired: os.killpg(server.pid,9);server.wait()
    log.close()
print('Actual App + saveCloudSave: two isolated browser sessions, server claim, stale save fence, reload, offline/online, nonparticipant and real PvE attack/outcome passed. Not Telegram or physical devices.')
