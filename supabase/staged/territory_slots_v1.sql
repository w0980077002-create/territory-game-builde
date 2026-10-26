-- REVIEWED INSTALLATION REQUIRED. Disabled by default; existing Hall is prerequisite.
-- Stakes debit Hall tickets. Prizes use existing protected Hall gold claim pipeline.
-- No existing player snapshots, balances or administrator ticket grants are changed.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.slots_release_v1(id integer PRIMARY KEY CHECK(id=1),enabled boolean NOT NULL DEFAULT false);
INSERT INTO territory_private.slots_release_v1(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS territory_private.slots_rounds_v1(
 player_id uuid PRIMARY KEY REFERENCES public.players(id),
 state jsonb NOT NULL DEFAULT '{"phase":"ready","revision":0,"pending":0,"riskSteps":0,"opened":[],"picksLeft":5,"shields":0}',
 bonus_deck jsonb NOT NULL DEFAULT '[]', super_deck jsonb NOT NULL DEFAULT '[]',risk_deck jsonb NOT NULL DEFAULT '[]',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS territory_private.slots_receipts_v1(
 player_id uuid NOT NULL REFERENCES public.players(id),operation_id uuid NOT NULL,arguments jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(player_id,operation_id)
);
ALTER TABLE territory_private.slots_release_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.slots_rounds_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.slots_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.slots_release_v1,territory_private.slots_rounds_v1,territory_private.slots_receipts_v1 FROM PUBLIC,anon,authenticated;

-- Cryptographically random rejection sampling from the random 32 bits of UUIDv4.
CREATE OR REPLACE FUNCTION territory_private.slots_random_v1(p_max integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path='pg_catalog' AS $$
DECLARE n bigint; threshold bigint;
BEGIN
 IF p_max IS NULL OR p_max NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'slots_invalid_random'; END IF;
 threshold:=4294967296-(4294967296 % p_max);
 LOOP
  n:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint;
  EXIT WHEN n<threshold;
 END LOOP;
 RETURN (n % p_max)::integer;
END $$;
CREATE OR REPLACE FUNCTION territory_private.slots_config_v1() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='pg_catalog' AS $config$ SELECT $json${
  "lines": [
    [
      1,
      1,
      1,
      1,
      1
    ],
    [
      0,
      0,
      0,
      0,
      0
    ],
    [
      2,
      2,
      2,
      2,
      2
    ],
    [
      0,
      1,
      2,
      1,
      0
    ],
    [
      2,
      1,
      0,
      1,
      2
    ],
    [
      0,
      0,
      1,
      2,
      2
    ],
    [
      2,
      2,
      1,
      0,
      0
    ],
    [
      1,
      0,
      0,
      0,
      1
    ],
    [
      1,
      2,
      2,
      2,
      1
    ]
  ],
  "paytable": {
    "wild": [
      24,
      80,
      240
    ],
    "boss": [
      16,
      52,
      152
    ],
    "wolf": [
      12,
      36,
      112
    ],
    "follower": [
      10,
      30,
      88
    ],
    "sword": [
      8,
      24,
      72
    ],
    "helmet": [
      6,
      18,
      56
    ],
    "gem": [
      5,
      14,
      44
    ],
    "gold": [
      4,
      10,
      32
    ]
  },
  "strips": [
    [
      "follower",
      "sword",
      "gold",
      "helmet",
      "gem",
      "gem",
      "gem",
      "gem",
      "hero",
      "follower",
      "sword",
      "boss",
      "wolf",
      "wolf",
      "gem",
      "sword",
      "gold",
      "follower",
      "gold",
      "follower",
      "gold",
      "wolf",
      "boss",
      "wolf",
      "sword",
      "gem",
      "sword",
      "wild",
      "gold",
      "gold",
      "helmet",
      "gold",
      "helmet",
      "boss",
      "helmet",
      "gem",
      "helmet",
      "hero",
      "gold",
      "helmet"
    ],
    [
      "gold",
      "hero",
      "gold",
      "gold",
      "sword",
      "sword",
      "sword",
      "gem",
      "wild",
      "gem",
      "gem",
      "sword",
      "gold",
      "boss",
      "boss",
      "wolf",
      "sword",
      "helmet",
      "helmet",
      "follower",
      "follower",
      "gold",
      "gold",
      "boss",
      "helmet",
      "hero",
      "gem",
      "gem",
      "helmet",
      "gem",
      "wolf",
      "gem",
      "helmet",
      "wolf",
      "follower",
      "gold",
      "wolf",
      "follower",
      "gold",
      "helmet"
    ],
    [
      "gold",
      "helmet",
      "helmet",
      "sword",
      "gem",
      "helmet",
      "gem",
      "gem",
      "gem",
      "sword",
      "gold",
      "follower",
      "gold",
      "sword",
      "wolf",
      "follower",
      "gem",
      "helmet",
      "follower",
      "gem",
      "gold",
      "follower",
      "gold",
      "sword",
      "boss",
      "helmet",
      "wild",
      "wolf",
      "gem",
      "wolf",
      "boss",
      "helmet",
      "wolf",
      "gold",
      "hero",
      "hero",
      "gold",
      "sword",
      "boss",
      "gold"
    ],
    [
      "gold",
      "gold",
      "wolf",
      "wolf",
      "boss",
      "sword",
      "gold",
      "boss",
      "boss",
      "gem",
      "follower",
      "helmet",
      "gem",
      "gold",
      "gold",
      "sword",
      "gem",
      "gold",
      "follower",
      "sword",
      "helmet",
      "wolf",
      "sword",
      "helmet",
      "wild",
      "gold",
      "gem",
      "helmet",
      "gem",
      "helmet",
      "gold",
      "hero",
      "wolf",
      "hero",
      "helmet",
      "gem",
      "follower",
      "follower",
      "gem",
      "sword"
    ],
    [
      "gold",
      "gold",
      "gem",
      "helmet",
      "helmet",
      "wolf",
      "boss",
      "gem",
      "wolf",
      "wild",
      "gold",
      "sword",
      "gold",
      "boss",
      "helmet",
      "sword",
      "gem",
      "helmet",
      "hero",
      "wolf",
      "follower",
      "follower",
      "follower",
      "follower",
      "wolf",
      "gold",
      "gold",
      "boss",
      "gold",
      "sword",
      "helmet",
      "hero",
      "gem",
      "gem",
      "sword",
      "sword",
      "gem",
      "gold",
      "helmet",
      "gem"
    ]
  ]
}$json$::jsonb $config$;

CREATE OR REPLACE FUNCTION territory_private.slots_score_v1(p_grid jsonb,p_lines integer,p_bet integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='pg_catalog' AS $$
DECLARE cfg jsonb:=territory_private.slots_config_v1(); line integer; dir integer; reel integer; row_n integer;
 target text; symbol text; cnt integer; paid integer; best integer; total integer:=0; heroes integer:=0;
 wins jsonb:='[]'; positions jsonb; best_positions jsonb; best_target text; best_count integer;
BEGIN
 IF p_lines IS NULL OR p_lines NOT IN(1,3,5,7,9) OR p_bet IS NULL OR p_bet NOT IN(1,2,5,10)
  OR jsonb_typeof(p_grid)<>'array' OR jsonb_array_length(p_grid)<>5 THEN RAISE EXCEPTION 'slots_invalid_grid'; END IF;
 FOR reel IN 0..4 LOOP
  IF jsonb_typeof(p_grid->reel)<>'array' OR jsonb_array_length(p_grid->reel)<>3 THEN RAISE EXCEPTION 'slots_invalid_grid'; END IF;
  FOR row_n IN 0..2 LOOP
   symbol:=p_grid->reel->>row_n;
   IF symbol IS NULL OR symbol NOT IN('hero','wild','boss','wolf','follower','sword','helmet','gem','gold') THEN RAISE EXCEPTION 'slots_invalid_grid'; END IF;
   IF symbol='hero' THEN heroes:=heroes+1; END IF;
  END LOOP;
 END LOOP;
 FOR line IN 0..p_lines-1 LOOP
  best:=0;best_positions:='[]';
  FOR dir IN 0..1 LOOP
   FOR target IN SELECT jsonb_object_keys(cfg->'paytable') LOOP
    cnt:=0;positions:='[]';
    FOR row_n IN 0..4 LOOP
     reel:=CASE WHEN dir=0 THEN row_n ELSE 4-row_n END;
     symbol:=p_grid->reel->>((cfg->'lines'->line->>reel)::integer);
     EXIT WHEN symbol<>target AND symbol<>'wild';
     cnt:=cnt+1;positions:=positions||jsonb_build_array(jsonb_build_array(reel,(cfg->'lines'->line->>reel)::integer));
    END LOOP;
    IF cnt>=3 THEN
     paid:=(cfg->'paytable'->target->>(cnt-3))::integer*p_bet;
     IF paid>best THEN best:=paid;best_positions:=positions;best_target:=target;best_count:=cnt; END IF;
    END IF;
   END LOOP;
  END LOOP;
  IF best>0 THEN
   wins:=wins||jsonb_build_array(jsonb_build_object('number',line+1,'count',best_count,'symbol',best_target,'payout',best,'positions',best_positions));
   total:=total+best;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('grid',p_grid,'lines',wins,'payout',total,'bonusSymbols',heroes);
END $$;

CREATE OR REPLACE FUNCTION public.territory_slots_v1(p_action text DEFAULT 'status',p_operation uuid DEFAULT NULL,
 p_lines integer DEFAULT NULL,p_bet integer DEFAULT NULL,p_choice integer DEFAULT NULL,p_expected integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $$
DECLARE u uuid:=auth.uid();a territory_private.hall_accounts_v1%ROWTYPE;r territory_private.slots_rounds_v1%ROWTYPE;
 args jsonb:=jsonb_build_object('action',p_action,'lines',p_lines,'bet',p_bet,'choice',p_choice,'expected',p_expected);
 old territory_private.slots_receipts_v1%ROWTYPE;result jsonb;cfg jsonb:=territory_private.slots_config_v1();
 s jsonb;outcome jsonb;grid jsonb:='[]';col jsonb;stops jsonb:='[]';stop_n integer;i integer;j integer;n integer;
 deck jsonb;temp jsonb;phase text;pending integer;stake integer;heroes integer;left_n integer;shields integer;
 tile jsonb;kind text;opened jsonb;award integer:=0;chunk integer;rev integer;
 status_tickets integer;status_pending integer;status_state jsonb;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT banned) THEN RAISE EXCEPTION 'slots_login_required'; END IF;
 IF p_action IS NULL OR p_action NOT IN('status','spin','bonus','super','risk_start','risk','collect') THEN RAISE EXCEPTION 'slots_invalid_action'; END IF;
 IF p_action='status' THEN
  IF p_operation IS NOT NULL OR p_lines IS NOT NULL OR p_bet IS NOT NULL OR p_choice IS NOT NULL OR p_expected IS NOT NULL THEN RAISE EXCEPTION 'slots_invalid_arguments'; END IF;
 ELSE
  IF p_operation IS NULL OR p_expected IS NULL OR p_expected<0 THEN RAISE EXCEPTION 'slots_operation_required'; END IF;
  IF p_action='spin' THEN
   IF p_lines IS NULL OR p_lines NOT IN(1,3,5,7,9) OR p_bet IS NULL OR p_bet NOT IN(1,2,5,10) OR p_choice IS NOT NULL THEN RAISE EXCEPTION 'slots_invalid_arguments'; END IF;
  ELSIF p_lines IS NOT NULL OR p_bet IS NOT NULL OR
   (p_action IN('bonus','super','risk') AND (p_choice IS NULL OR p_choice<0 OR p_choice>CASE p_action WHEN 'bonus' THEN 4 WHEN 'super' THEN 2 ELSE 3 END)) OR
   (p_action IN('collect','risk_start') AND p_choice IS NOT NULL) THEN RAISE EXCEPTION 'slots_invalid_arguments'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM territory_private.slots_release_v1 WHERE id=1 AND enabled) THEN
  IF p_action='status' THEN RETURN jsonb_build_object('enabled',false); END IF;
  RAISE EXCEPTION 'slots_not_enabled';
 END IF;
 -- Status is a read-only snapshot. Opening the Hall must not create account
 -- rows or wait for the same FOR UPDATE locks used by bets and gold claims.
 -- A missing Hall account has the existing four-ticket starting balance.
 IF p_action='status' THEN
  SELECT ha.tickets,ha.pending_gold,sr.state INTO status_tickets,status_pending,status_state
  FROM public.players p
  LEFT JOIN territory_private.hall_accounts_v1 ha ON ha.player_id=p.id
  LEFT JOIN territory_private.slots_rounds_v1 sr ON sr.player_id=p.id WHERE p.id=u;
  RETURN jsonb_build_object('enabled',true,'tickets',COALESCE(status_tickets,4),
   'hallPending',COALESCE(status_pending,0),'collected',0,
   'state',COALESCE(status_state,'{"phase":"ready","revision":0,"pending":0,"riskSteps":0,"opened":[],"picksLeft":5,"shields":0}'::jsonb));
 END IF;
 INSERT INTO territory_private.hall_accounts_v1(player_id) VALUES(u) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=u FOR UPDATE;
 INSERT INTO territory_private.slots_rounds_v1(player_id) VALUES(u) ON CONFLICT DO NOTHING;
 SELECT * INTO r FROM territory_private.slots_rounds_v1 WHERE player_id=u FOR UPDATE;
 IF p_action<>'status' THEN
  SELECT * INTO old FROM territory_private.slots_receipts_v1 WHERE player_id=u AND operation_id=p_operation;
  IF FOUND THEN
   IF old.arguments IS DISTINCT FROM args THEN RAISE EXCEPTION 'slots_operation_reused'; END IF;
   RETURN old.result;
  END IF;
 END IF;
 s:=r.state;phase:=s->>'phase';pending:=(s->>'pending')::integer;rev:=COALESCE((s->>'revision')::integer,0);
 IF p_action<>'status' AND p_expected IS DISTINCT FROM rev THEN RAISE EXCEPTION 'slots_stale_round'; END IF;
 IF p_action='spin' THEN
  IF phase<>'ready' OR pending<>0 THEN RAISE EXCEPTION 'slots_round_unfinished'; END IF;
  IF EXISTS(SELECT 1 FROM territory_private.hall_sessions_v1 WHERE player_id=u AND created_at>clock_timestamp()-interval '15 minutes') THEN RAISE EXCEPTION 'slots_hall_round_active'; END IF;
  stake:=p_lines*p_bet;
  IF a.tickets<stake THEN RAISE EXCEPTION 'slots_no_tickets'; END IF;
  FOR i IN 0..4 LOOP
   stop_n:=territory_private.slots_random_v1(40);stops:=stops||to_jsonb(stop_n);col:='[]';
   FOR j IN 0..2 LOOP col:=col||jsonb_build_array(cfg->'strips'->i->((stop_n+j)%40)); END LOOP;
   grid:=grid||jsonb_build_array(col);
  END LOOP;
  outcome:=territory_private.slots_score_v1(grid,p_lines,p_bet)||jsonb_build_object('stops',stops);
  heroes:=(outcome->>'bonusSymbols')::integer;pending:=(outcome->>'payout')::integer;
  phase:=CASE WHEN heroes>=3 THEN 'bonus' WHEN pending>0 THEN 'decision' ELSE 'ready' END;
  deck:=jsonb_build_array(jsonb_build_object('kind','treasure','payout',stake),jsonb_build_object('kind','treasure','payout',stake*2),jsonb_build_object('kind','treasure','payout',stake*3),jsonb_build_object('kind','shield','payout',0),jsonb_build_object('kind','trap','payout',0));
  FOR i IN REVERSE 4..1 LOOP
   j:=territory_private.slots_random_v1(i+1);temp:=deck->i;deck:=jsonb_set(jsonb_set(deck,ARRAY[i::text],deck->j),ARRAY[j::text],temp);
  END LOOP;
  r.bonus_deck:=deck;
  deck:=jsonb_build_array(stake*3,stake*5,stake*9);
  FOR i IN REVERSE 2..1 LOOP
   j:=territory_private.slots_random_v1(i+1);temp:=deck->i;deck:=jsonb_set(jsonb_set(deck,ARRAY[i::text],deck->j),ARRAY[j::text],temp);
  END LOOP;
  r.super_deck:=deck;r.risk_deck:='[]';
  s:=jsonb_build_object('phase',phase,'pending',pending,'lines',p_lines,'bet',p_bet,'stake',stake,'outcome',outcome,'riskSteps',0,'opened','[]'::jsonb,'picksLeft',5,'shields',CASE WHEN heroes>=4 THEN 1 ELSE 0 END,'revealed','{}'::jsonb);
  UPDATE territory_private.hall_accounts_v1 SET tickets=tickets-stake WHERE player_id=u RETURNING * INTO a;
 ELSIF p_action='bonus' THEN
  IF phase<>'bonus' THEN RAISE EXCEPTION 'slots_wrong_phase'; END IF;
  opened:=s->'opened';
  IF opened @> jsonb_build_array(p_choice) THEN RAISE EXCEPTION 'slots_already_opened'; END IF;
  tile:=r.bonus_deck->p_choice;kind:=tile->>'kind';left_n:=(s->>'picksLeft')::integer-1;shields:=(s->>'shields')::integer;
  pending:=pending+(tile->>'payout')::integer;
  IF kind='shield' THEN shields:=shields+1;
  ELSIF kind='trap' THEN
   IF shields>0 THEN shields:=shields-1;ELSE phase:=CASE WHEN pending>0 THEN 'decision' ELSE 'ready' END;END IF;
  END IF;
  IF left_n=0 AND phase='bonus' THEN phase:='superbonus'; END IF;
  s:=s||jsonb_build_object('phase',phase,'pending',pending,'opened',opened||to_jsonb(p_choice),'picksLeft',left_n,'shields',shields,'revealed',(s->'revealed')||jsonb_build_object(p_choice::text,tile));
 ELSIF p_action='super' THEN
  IF phase<>'superbonus' THEN RAISE EXCEPTION 'slots_wrong_phase'; END IF;
  pending:=pending+(r.super_deck->>p_choice)::integer;
  s:=s||jsonb_build_object('phase','decision','pending',pending,'superChoice',p_choice,'superAward',(r.super_deck->>p_choice)::integer);
 ELSIF p_action='risk_start' THEN
  IF phase<>'decision' OR pending<=0 OR (s->>'riskSteps')::integer>=5 OR pending>1073741823 THEN RAISE EXCEPTION 'slots_wrong_phase'; END IF;
  deck:='[true,false,true,false]';
  FOR i IN REVERSE 3..1 LOOP
   j:=territory_private.slots_random_v1(i+1);temp:=deck->i;deck:=jsonb_set(jsonb_set(deck,ARRAY[i::text],deck->j),ARRAY[j::text],temp);
  END LOOP;
  r.risk_deck:=deck;s:=s||jsonb_build_object('phase','risk');
 ELSIF p_action='risk' THEN
  IF phase<>'risk' THEN RAISE EXCEPTION 'slots_wrong_phase'; END IF;
  pending:=CASE WHEN (r.risk_deck->>p_choice)::boolean THEN pending*2 ELSE 0 END;
  s:=s||jsonb_build_object('phase',CASE WHEN pending>0 THEN 'decision' ELSE 'ready' END,'pending',pending,'riskSteps',(s->>'riskSteps')::integer+1,'riskChoice',p_choice,'riskWon',(r.risk_deck->>p_choice)::boolean);
 ELSIF p_action='collect' THEN
  IF phase NOT IN('decision','bonus') OR pending<=0 THEN RAISE EXCEPTION 'slots_wrong_phase'; END IF;
  -- Existing Hall pending wallet is bounded. Keep every excess coin in this round.
  chunk:=least(pending,greatest(0,100000-a.pending_gold));
  IF chunk=0 THEN RAISE EXCEPTION 'slots_claim_hall_first'; END IF;
  UPDATE territory_private.hall_accounts_v1 SET pending_gold=pending_gold+chunk WHERE player_id=u RETURNING * INTO a;
  pending:=pending-chunk;award:=chunk;
  s:=s||jsonb_build_object('phase',CASE WHEN pending>0 THEN 'decision' ELSE 'ready' END,'pending',pending);
 END IF;
 IF p_action<>'status' THEN
  s:=s||jsonb_build_object('revision',rev+1);
  UPDATE territory_private.slots_rounds_v1 SET state=s,bonus_deck=r.bonus_deck,super_deck=r.super_deck,risk_deck=r.risk_deck,updated_at=clock_timestamp() WHERE player_id=u;
 END IF;
 result:=jsonb_build_object('enabled',true,'tickets',a.tickets,'hallPending',a.pending_gold,'state',s,'collected',award);
 IF p_action<>'status' THEN INSERT INTO territory_private.slots_receipts_v1(player_id,operation_id,arguments,result) VALUES(u,p_operation,args,result); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION territory_private.slots_random_v1(integer),territory_private.slots_config_v1(),territory_private.slots_score_v1(jsonb,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.territory_slots_v1(text,uuid,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_slots_v1(text,uuid,integer,integer,integer,integer) TO authenticated,service_role;
COMMIT;
