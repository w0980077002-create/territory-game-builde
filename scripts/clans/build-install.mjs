import { readFileSync, writeFileSync } from 'node:fs';
const schema = readFileSync('supabase/migrations/20261017_clans_schema_v1.sql', 'utf8');
const functions = readFileSync('supabase/migrations/20261017_clans_functions_snapshot.sql', 'utf8');
const tables = [...schema.matchAll(/CREATE TABLE (\w+) \(/g)].map(m => m[1]);
const clientRpcs = new Set(['clan_invite_candidates', 'clan_directory', 'clan_state', 'clan_rankings', 'clan_create', 'clan_contribute', 'clan_boss_claim', 'clan_quest_claim', 'clan_apply', 'clan_cancel_application', 'clan_accept_invite', 'clan_decline_invite', 'clan_leave', 'clan_kick', 'clan_set_role', 'clan_transfer', 'clan_invite_player', 'clan_accept_app', 'clan_reject_app', 'clan_chat_send', 'clan_chat_mute', 'clan_building_upgrade', 'clan_building_collect', 'clan_boss_attack', 'clan_boss_sync', 'clan_war_signup', 'clan_war_strike', 'clan_update', 'clan_profile']);
const signatures = [...functions.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^\n]*)\)/g)].map(m => ({name:m[1], args:m[2].replace(/ DEFAULT [^,]+/g, '').split(',').filter(Boolean).map(arg => arg.trim().replace(/^\w+\s+/, '')).join(', ')}));
let access = tables.map(t => `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;\nREVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`).join('\n');
access += '\nGRANT SELECT ON public.clan_members TO authenticated;\n';
access += 'REVOKE ALL ON FUNCTION public.clan_member_of(uuid, uuid) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.clan_member_of(uuid, uuid) TO authenticated;\n';
for (const {name,args} of signatures) {
  access += `REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated;\n`;
  if (clientRpcs.has(name)) access += `GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO authenticated;\n`;
}
writeFileSync('supabase/staged/territory_stage1_clans_install.sql', '-- REVIEW REQUIRED: new clan installation only; aborts if clan tables already exist.\n-- No player progress is rewritten. RPC-only writes; internal reward helpers are private.\nBEGIN;\n'+schema+'\n'+functions+'\n'+access+'\nCOMMIT;\n');
