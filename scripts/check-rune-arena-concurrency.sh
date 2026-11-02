#!/usr/bin/env bash
# Disposable arena fixture database only. PostgreSQL serializes arena_tick on the room row.
set -euo pipefail
: "${RUNE_TEST_DATABASE_URL:?disposable test database URL required}"
psql "$RUNE_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO arena_moves(room_id,round_no,participant_id,target_id,attack_zone,block_zones)
SELECT a.room_id,2,a.id,t.id,'chest',ARRAY['head','legs']
FROM arena_participants a JOIN arena_participants t ON t.room_id=a.room_id AND t.team<>a.team
WHERE a.room_id='41000000-0000-4000-8000-000000000001';
SQL
psql "$RUNE_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT public.arena_tick('41000000-0000-4000-8000-000000000001')" > /dev/null &
first=$!
psql "$RUNE_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT public.arena_tick('41000000-0000-4000-8000-000000000001')" > /dev/null &
second=$!
wait "$first"
wait "$second"
psql "$RUNE_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT round_no FROM public.arena_rooms WHERE id='41000000-0000-4000-8000-000000000001')<>3
 THEN RAISE EXCEPTION 'arena_concurrent_double_resolution'; END IF;
END $$;
SQL
