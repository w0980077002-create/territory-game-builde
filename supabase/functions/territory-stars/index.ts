import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createStarsHandler } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL') ?? '';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const token = Deno.env.get('TELEGRAM_BOT_TOKEN') || Deno.env.get('BOT_TOKEN') || '';
const secret = Deno.env.get('TERRITORY_STARS_WEBHOOK_SECRET') ?? '';
const backend = () => createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const caller = (bearer: string) => createClient(url, anon, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false } });
const handler = createStarsHandler({
  webhookSecret: secret,
  async authenticate(bearer) { const { data, error } = await caller(bearer).auth.getUser(bearer); return !error && !!data.user; },
  async callerRpc(bearer, name, args) { const { data, error } = await caller(bearer).rpc(name, args); if (error) throw error; return data; },
  async serverRpc(name, args) { const { data, error } = await backend().rpc(name, args); if (error) throw error; return data; },
  async telegram(method, args) {
    if (!token || !secret) throw new Error('stars_not_configured');
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(7000) });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error('telegram_request_failed');
    return result.result;
  },
});
Deno.serve((request: Request) => {
  if (!url || !anon || !service || !token || !secret) return new Response(JSON.stringify({ error: 'stars_not_configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  return handler(request);
});
