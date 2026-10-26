import type { ClanState } from './clanApi';

/** The SQL RPC uses compact nested records; keep that wire format out of the UI. */
export function normalizeClanState(data: unknown): ClanState {
  if (!data || typeof data !== 'object') throw new Error('clan_invalid_receipt');
  const d = data as Record<string, any>;
  if (!d.clan || !Array.isArray(d.members) || !Array.isArray(d.chat) || !d.quests) {
    throw new Error('clan_invalid_receipt');
  }
  return {
    ...d,
    clan: d.clan,
    my_role: d.my_role,
    applications: d.applications ?? [],
    buildings: d.clan.buildings ?? {},
    members: d.members.map((m: Record<string, any>) => ({ ...m, display_name: m.name })),
    chat: d.chat.map((m: Record<string, any>) => ({ ...m, author_name: m.author, author_role: m.role, created_at: m.at })),
    events: (d.events ?? []).map((e: Record<string, any>) => ({ ...e, created_at: e.at })),
    treasury_log: (d.treasury_log ?? []).map((e: Record<string, any>) => ({ ...e, created_at: e.at })),
    pending_boss_rewards: d.pending_boss_rewards ?? [],
    boss: d.boss ? { ...d.boss, boss_no: d.boss.no } : null,
    my_boss_damage: d.boss?.my_damage ?? 0,
    boss_attacks_left: d.boss?.attacks_left ?? 0,
    boss_claimed: d.boss?.claimed ?? false,
    quests: Object.entries(d.quests).map(([id, quest]) => ({ id, ...(quest as object) })),
    war: d.war ? { ...d.war, score_a: d.war.my_score, score_b: d.war.enemy_score, my_side: 'a', enemy_name: d.war.enemy.name, enemy_tag: d.war.enemy.tag } : null,
    my_war_strikes_today: d.war ? 5 - d.war.strikes_left : 0,
    season: d.clan.season_ends_at ? { started_at: '', ends_at: d.clan.season_ends_at } : null,
  } as ClanState;
}

