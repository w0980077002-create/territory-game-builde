import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { executeCombatCommand } from '../../../src/game/combatV1/service.ts';
import type { CombatContext, CombatRepository } from '../../../src/game/combatV1/service.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Apikey, X-Client-Info' };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return respond({ error: 'method_not_allowed' }, 405);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) return respond({ error: 'combat_auth_required' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return respond({ error: 'combat_not_configured' }, 503);
  try {
    const auth = createClient(url, anon, { auth: { persistSession: false } });
    const { data: { user }, error } = await auth.auth.getUser(bearer);
    if (error || !user) return respond({ error: 'combat_auth_required' }, 401);
    // Read a bounded request stream; never buffer an unbounded unauthenticated body.
    const reader = request.body?.getReader();
    if (!reader) return respond({ error: 'combat_invalid_command' }, 400);
    let body = '', bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32_768) { await reader.cancel(); return respond({ error: 'request_too_large' }, 413); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const db = createClient(url, service, { auth: { persistSession: false } });
    const payload: unknown = JSON.parse(body);
    // Preparation commits separately so a reconciliation request is not rolled
    // back when a subsequent start is refused. Identity always comes from auth.
    if (payload && typeof payload === 'object' && !Array.isArray(payload)
      && (payload as Record<string, unknown>).action === 'prepare') {
      if (Object.keys(payload).length !== 1) return respond({ error: 'combat_invalid_command' }, 400);
      const { data, error } = await db.rpc('territory_combat_prepare_profile_v1', { p_player: user.id });
      if (error || !data) throw new Error('combat_profile_unavailable');
      return respond(data);
    }
    const repository: CombatRepository = {
      async context(player, command) {
        const { data, error } = await db.rpc('territory_combat_context_v1', { p_player: player, p_request: command });
        if (error || !data) throw new Error(error?.message || 'combat_context_unavailable');
        return data as CombatContext;
      },
      async commit(player, command, context, result) {
        const { data, error } = await db.rpc('territory_combat_commit_v1', {
          p_player: player, p_request: command, p_context: context, p_result: result,
        });
        if (error || !data) throw new Error(error?.message || 'combat_commit_unavailable');
        return data;
      },
    };
    const receipt = await executeCombatCommand(repository, user.id, payload,
      () => crypto.getRandomValues(new Uint32Array(1))[0]);
    return respond(receipt);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // Do not expose SQL, private account data or server configuration in responses.
    const code = message.match(/\bcombat_[a-z_]+\b/)?.[0];
    return respond({ error: code || 'combat_unavailable' }, code ? 409 : 503);
  }
});
