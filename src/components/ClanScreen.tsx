import { useEffect, useState, useCallback } from 'react';
import {
  fetchClanDirectory, fetchClanState, fetchClanRankings,
  createClan, contributeClan, claimClanBoss, claimClanQuest,
  CLAN_CREATION_RED_GEMS_COST,
  clanApply, clanCancelApplication, clanAcceptInvite, clanDeclineInvite,
  clanLeave, clanKick, clanSetRole, clanTransfer,
  clanAcceptApp, clanRejectApp, clanChatSend, clanChatMute,
  clanBuildingUpgrade, clanBuildingCollect, clanBossAttack, clanBossSync,
  clanWarSignup, clanWarStrike,
  type ClanDirectory, type ClanState, type SimpleResult, type WalletReceipt,
} from '@/game/clanApi';import { unblockSave } from '@/game/cloudInt';
import { useGame } from '@/game/actions';
import { useStore } from '@/game/store';
import { validEconomySnapshot } from '@/game/economyInvariant';
import { Users, Swords, Crown, Shield, Coins, ChevronLeft, Send, ScrollText, Gem } from 'lucide-react';
import { useLanguage } from '@/game/i18n';

const CLAN_COLORS = ['#eab308', '#ef4444', '#22c55e', '#3b82f6', '#f97316', '#ec4899', '#14b8a6', '#a3e635'];
const EMBLEMS = ['🐺', '🦁', '🐉', '🦅', '🐻', '🐺', '⚔️', '🛡️', '🔥', '🌊', '⚡', '🌟'];
const ROLE_ORDER: Record<string, number> = { leader: 0, deputy: 1, officer: 2, veteran: 3, member: 4 };

type Props = { userId: string; notify: (text: string) => void };

function errKey(error: string): string {
  const key = error.split('\n')[0].trim();
  if (/clan_not_enough_red_gems/.test(key)) return 'clanErrRedGems';
  if (/clan_not_enough_gold/.test(key)) return 'clanErrGold';
  if (/clan_bad_name/.test(key)) return 'clanErrName';
  if (/clan_bad_tag/.test(key)) return 'clanErrTag';
  if (/clan_bad_color/.test(key)) return 'clanErrColor';
  if (/clan_duplicate/.test(key)) return 'clanErrDuplicate';
  if (/clan_already_member/.test(key)) return 'clanErrAlreadyMember';
  if (/clan_no_permission/.test(key)) return 'clanErrPermission';
  if (/clan_full/.test(key)) return 'clanErrFull';
  if (/clan_level_required/.test(key)) return 'clanErrLevel';
  if (/clan_reload_save/.test(key)) return 'clanErrReload';
  if (/clan_chat_slow/.test(key)) return 'clanErrChatSlow';
  if (/clan_quest_locked/.test(key)) return 'clanErrQuestLocked';
  if (/clan_boss_claimed|no_damage/.test(key)) return 'clanErrBossClaimed';
  if (/clan_leader_must_transfer/.test(key)) return 'clanErrTransfer';
  if (/clan_login_required/.test(key)) return 'clanErrReload';
  if (/clan_invalid_wallet|clan_invalid_receipt/.test(key)) return 'clanErrReload';
  if (/row-level security|permission denied/.test(key)) return 'clanErrPermission';
  return 'clanErrGeneric';
}

function isStateShaped(v: unknown): v is ClanState {
  return !!v && typeof v === 'object' && 'clan' in (v as object) && 'members' in (v as object);
}

function Emblem({ emblem, color1, color2, size = 40 }: { emblem: number; color1: string; color2: string; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border-2 shrink-0"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${color1}, ${color2})`, borderColor: color1, fontSize: size * 0.5 }}
    >
      <span>{EMBLEMS[(emblem - 1 + EMBLEMS.length) % EMBLEMS.length]}</span>
    </div>
  );
}

function ApplyButton({ onResult, children, className }: { onResult: () => Promise<SimpleResult>; children: React.ReactNode; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      className={className ?? 'rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm font-bold text-amber-100 active:scale-95 transition-transform disabled:opacity-50'}
      onClick={async () => { setBusy(true); const r = await onResult(); setBusy(false); return r; }}
    >
      {children}
    </button>
  );
}

export function ClanScreen({ userId, notify }: Props) {
  const { language, t } = useLanguage();
  const [dir, setDir] = useState<ClanDirectory | null>(null);
  const [clanId, setClanId] = useState<string | null>(null);
  const [state, setState] = useState<ClanState | null>(null);
  const [rankings, setRankings] = useState<Awaited<ReturnType<typeof fetchClanRankings>> | null>(null);
  const [view, setView] = useState<'home' | 'browse' | 'create' | 'detail' | 'rankings'>('home');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');

  // create form
  const [form, setForm] = useState({ name: '', tag: '', emblem: 1, color1: CLAN_COLORS[0], color2: '#1e293b', description: '', joinMode: 'apply', minLevel: 1 });

  const applyState = useCallback((receipt: WalletReceipt) => {
    if (validEconomySnapshot(receipt.state)) {
      useGame.set(receipt.state);
    } else {
      unblockSave(userId);
    }
  }, [userId]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errKey(e instanceof Error ? e.message : 'clan_error')); } finally { setBusy(false); }
  }, []);

  const loadDirectory = useCallback(async (query = '') => {
    const d = await fetchClanDirectory(query);
    setDir(d);
    if (d.my_clan_id) { setClanId(d.my_clan_id); setView('detail'); } else if (d.my_invites.length) { setView('home'); }
  }, []);

  useEffect(() => { void run(() => loadDirectory('')); }, [run, loadDirectory]);

  const loadState = useCallback(async (id: string) => {
    const s = await fetchClanState(id, userId);
    if (isStateShaped(s)) setState(s);
    else throw new Error('clan_error');
  }, [userId]);

  useEffect(() => {
    if (clanId && view === 'detail') { void run(() => loadState(clanId)); }
  }, [clanId, view, run, loadState]);

  const loadRankings = useCallback(async () => {
    const r = await fetchClanRankings();
    setRankings(r);
  }, []);

  useEffect(() => { if (view === 'rankings') void run(loadRankings); }, [view, run, loadRankings]);

  const openBrowse = () => { setView('browse'); void run(() => loadDirectory(search)); };

  const doCreate = () => run(async () => {
    const receipt = await createClan(userId, {
      name: form.name.trim(), tag: form.tag.trim(), emblem: form.emblem,
      color1: form.color1, color2: form.color2, description: form.description,
      joinMode: form.joinMode, minLevel: form.minLevel,
    });
    applyState(receipt);
    setClanId(receipt.clan_id);
    setView('detail');
    notify(t('clanCreated'));
  });

  const doContribute = (gold: number, materials: number) => run(async () => {
    if (!clanId) return;
    const receipt = await contributeClan(userId, clanId, gold, materials);
    applyState(receipt);
    await loadState(clanId);
  });

  const doBossClaim = () => run(async () => {
    if (!clanId) return;
    const receipt = await claimClanBoss(userId, clanId);
    applyState(receipt);
    await loadState(clanId);
    notify(t('clanRewardClaimed'));
  });

  const doQuestClaim = (questId: string) => run(async () => {
    if (!clanId) return;
    const receipt = await claimClanQuest(userId, clanId, questId);
    applyState(receipt);
    await loadState(clanId);
    notify(t('clanRewardClaimed'));
  });

  const simple = (fn: () => Promise<SimpleResult>, after?: () => Promise<void>) => run(async () => {
    const r = await fn();
    if (!r.ok) throw new Error(r.error);
    if (after) await after();
  });

  const doSendChat = () => run(async () => {
    if (!clanId || !chatDraft.trim()) return;
    const body = chatDraft.trim().slice(0, 300);
    setChatDraft('');
    const r = await clanChatSend(clanId, body);
    if (!r.ok) throw new Error(r.error);
    await loadState(clanId);
  });

  const doLeave = () => run(async () => {
    const r = await clanLeave();
    if (!r.ok) throw new Error(r.error);
    setClanId(null); setState(null); setView('home');
    await loadDirectory('');
  });

  const redGems = useStore(useGame).player.redGems;
  if (busy && !state && !dir) {
    return <div className="py-16 text-center text-sm text-gray-400">{t('loadingHero')}</div>;
  }

  return (
    <div className="pb-4">
      {error && (
        <div role="alert" className="mb-3 rounded-xl border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs font-semibold text-red-100" onClick={() => setError(null)}>
          {t(error)}
        </div>
      )}

      {view === 'home' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-b from-[#1a1610] to-[#0e0c08] p-4 text-center">
            <div className="mx-auto mb-3 w-16 h-16 rounded-2xl border-2 border-amber-400/50 bg-amber-500/10 flex items-center justify-center">
              <Users className="w-8 h-8 text-amber-300" />
            </div>
            <h2 className="text-lg font-bold text-white mb-1">{t('clanTitle')}</h2>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">{t('clanIntro')}</p>
            <div className="flex gap-2 justify-center">
              <ApplyButton onResult={async () => { openBrowse(); return { ok: true }; }} className="rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-4 py-2.5 text-sm font-extrabold text-black shadow-lg active:scale-95 transition-transform">
                {t('clanFind')}
              </ApplyButton>
              <ApplyButton onResult={async () => { setView('create'); return { ok: true }; }} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white active:scale-95 transition-transform">
                {t('clanCreate')}
              </ApplyButton>
            </div>
          </div>
          {dir && dir.my_invites.length > 0 && (
            <div className="rounded-2xl border border-sky-500/30 bg-sky-950/30 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-sky-200"><Gem className="w-4 h-4" /> {t('clanInvites')}</h3>
              {dir.my_invites.map((inv) => (
                <div key={inv.id} className="mb-2 flex items-center gap-2 rounded-xl bg-black/30 p-2 last:mb-0">
                  <Emblem emblem={inv.emblem} color1={inv.color1} color2={inv.color2} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-bold text-white">{inv.name} <span className="text-amber-300">[{inv.tag}]</span></p>
                    <p className="text-[10px] text-gray-400">{inv.members} {t('clanMembersShort')}</p>
                  </div>
                  <button onClick={() => void simple(() => clanAcceptInvite(inv.clan_id), () => loadDirectory(''))} className="rounded-lg bg-emerald-500/20 border border-emerald-400/40 px-2.5 py-1.5 text-xs font-bold text-emerald-200">{t('clanAccept')}</button>
                  <button onClick={() => void simple(() => clanDeclineInvite(inv.clan_id), () => loadDirectory(''))} className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs font-bold text-gray-300">{t('clanDecline')}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'browse' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setView('home')} className="rounded-xl border border-white/10 bg-white/5 p-2 text-gray-300"><ChevronLeft className="w-4 h-4" /></button>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void run(() => loadDirectory(search)); }}
              placeholder={t('clanSearch')}
              className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-amber-400/50 focus:outline-none"
            />
            <button onClick={() => void run(() => loadDirectory(search))} className="rounded-xl bg-amber-500/20 border border-amber-400/40 px-3 py-2 text-xs font-bold text-amber-200">{t('clanSearchBtn')}</button>
          </div>
          {!dir && <p className="py-8 text-center text-sm text-gray-400">{t('loadingHero')}</p>}
          {dir && dir.clans.length === 0 && <p className="py-8 text-center text-sm text-gray-400">{t('clanNone')}</p>}
          {dir && dir.clans.map((c) => {
            const applied = dir.my_applications.includes(c.id);
            const full = c.members >= c.capacity;
            return (
              <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center gap-2.5">
                  <Emblem emblem={c.emblem} color1={c.color1} color2={c.color2} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-bold text-white">{c.name} <span style={{ color: c.color1 }}>[{c.tag}]</span></p>
                    <p className="text-[11px] text-gray-400">
                      {t('clanLevelShort')} {c.level} · {c.members}/{c.capacity} {t('clanMembersShort')}
                      {typeof c.online === 'number' && c.online > 0 && <span className="text-emerald-400"> · {c.online} {t('clanOnline')}</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-amber-300">{c.rating}</p>
                    <p className="text-[9px] text-gray-500">{t('clanRating')}</p>
                  </div>
                </div>
                {c.description && <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-gray-400">{c.description}</p>}
                <div className="mt-2.5 flex items-center gap-2">
                  {c.join_mode === 'open' ? (
                    <button
                      disabled={busy || full}
                      onClick={() => void simple(() => clanApply(c.id), () => loadDirectory(search))}
                      className="rounded-xl bg-emerald-500/20 border border-emerald-400/40 px-3.5 py-1.5 text-xs font-bold text-emerald-200 active:scale-95 transition-transform disabled:opacity-40"
                    >
                      {t('clanJoin')}
                    </button>
                  ) : c.join_mode === 'apply' ? (
                    applied ? (
                      <button onClick={() => void simple(() => clanCancelApplication(c.id), () => loadDirectory(search))} className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-bold text-gray-300">{t('clanCancelApp')}</button>
                    ) : (
                      <button
                        disabled={busy || full}
                        onClick={() => void simple(() => clanApply(c.id), () => loadDirectory(search))}
                        className="rounded-xl bg-amber-500/20 border border-amber-400/40 px-3.5 py-1.5 text-xs font-bold text-amber-200 active:scale-95 transition-transform disabled:opacity-40"
                      >
                        {t('clanApply')}
                      </button>
                    )
                  ) : (
                    <span className="text-[11px] font-semibold text-gray-500">{t('clanClosed')}</span>
                  )}
                  <span className="text-[10px] text-gray-500">
                    {c.join_mode === 'open' ? t('clanModeOpen') : c.join_mode === 'apply' ? t('clanModeApply') : ''} · {t('clanMinLevel')} {c.min_level}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'create' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setView('home')} className="rounded-xl border border-white/10 bg-white/5 p-2 text-gray-300"><ChevronLeft className="w-4 h-4" /></button>
            <h2 className="text-base font-bold text-white">{t('clanCreate')}</h2>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-gray-300">{t('clanName')}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.slice(0, 20) })} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-amber-400/50 focus:outline-none" placeholder={t('clanNamePh')} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-gray-300">{t('clanTag')}</label>
              <input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value.toUpperCase().slice(0, 5) })} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white uppercase focus:border-amber-400/50 focus:outline-none" placeholder={t('clanTagPh')} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-gray-300">{t('clanEmblem')}</label>
              <div className="grid grid-cols-6 gap-1.5">
                {EMBLEMS.map((em, i) => (
                  <button key={i} onClick={() => setForm({ ...form, emblem: i + 1 })} className={`aspect-square rounded-xl border-2 text-lg ${form.emblem === i + 1 ? 'border-amber-400 bg-amber-500/15' : 'border-white/10 bg-black/30'}`}>{em}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-gray-300">{t('clanColors')}</label>
              <div className="flex gap-1.5">
                {CLAN_COLORS.map((c) => (
                  <button key={c} onClick={() => setForm({ ...form, color1: c })} className={`h-7 w-7 rounded-lg border-2 ${form.color1 === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} aria-label={c} />
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-gray-300">{t('clanDesc')}</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, 500) })} rows={2} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-amber-400/50 focus:outline-none resize-none" placeholder={t('clanDescPh')} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-gray-300">{t('clanJoinMode')}</label>
                <select value={form.joinMode} onChange={(e) => setForm({ ...form, joinMode: e.target.value })} className="w-full rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-sm text-white focus:outline-none">
                  <option value="open">{t('clanModeOpen')}</option>
                  <option value="apply">{t('clanModeApply')}</option>
                  <option value="closed">{t('clanModeClosed')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-gray-300">{t('clanMinLevel')}</label>
                <select value={form.minLevel} onChange={(e) => setForm({ ...form, minLevel: Number(e.target.value) })} className="w-full rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-sm text-white focus:outline-none">
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                </select>
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
              <Gem className="w-3.5 h-3.5 text-red-400" /> {CLAN_CREATION_RED_GEMS_COST} — {t('clanCost')} ({t('clanYourRedGems')}: {redGems.toLocaleString()})
            </p>
            <button
              disabled={busy || form.name.trim().length < 3 || form.tag.trim().length < 2 || redGems < CLAN_CREATION_RED_GEMS_COST}
              onClick={doCreate}
              className="w-full rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 py-2.5 text-sm font-extrabold text-black shadow-lg active:scale-95 transition-transform disabled:opacity-40"
            >
              {t('clanCreateConfirm')}
            </button>
          </div>
        </div>
      )}

      {view === 'detail' && state && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => { setView('home'); setClanId(null); setState(null); }} className="rounded-xl border border-white/10 bg-white/5 p-2 text-gray-300"><ChevronLeft className="w-4 h-4" /></button>
            <h2 className="truncate text-base font-bold text-white">{state.clan.name} <span style={{ color: state.clan.color1 }}>[{state.clan.tag}]</span></h2>
          </div>

          <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-b from-[#1a1610] to-[#0e0c08] p-3">
            <div className="flex items-center gap-2.5">
              <Emblem emblem={state.clan.emblem} color1={state.clan.color1} color2={state.clan.color2} size={48} />
              <div className="flex-1">
                <p className="text-sm font-bold text-white">{t('clanLevelShort')} {state.clan.level} · {t('clanRating')} {state.clan.rating}</p>
                <p className="text-[11px] text-gray-400">{state.clan.members}/{state.clan.capacity} {t('clanMembersShort')} · {t('clanMedals')}: {state.clan.season_medal}</p>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: `${Math.min(100, (state.clan.xp / Math.max(1, state.clan.xp_needed)) * 100)}%` }} />
            </div>
            <p className="mt-1 text-right text-[10px] text-gray-500">{state.clan.xp} / {state.clan.xp_needed}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-black/30 p-2 text-center">
                <p className="flex items-center justify-center gap-1 text-xs font-bold text-amber-300"><Coins className="w-3.5 h-3.5" /> {state.clan.treasury_gold.toLocaleString()}</p>
                <p className="text-[9px] text-gray-500">{t('clanTreasury')}</p>
              </div>
              <div className="rounded-xl bg-black/30 p-2 text-center">
                <p className="flex items-center justify-center gap-1 text-xs font-bold text-sky-300"><Shield className="w-3.5 h-3.5" /> {state.clan.treasury_points}</p>
                <p className="text-[9px] text-gray-500">{t('clanPoints')}</p>
              </div>
            </div>
          </div>

          {state.boss && (
            <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-red-200"><Swords className="w-4 h-4" /> {t('clanBoss')} #{state.boss.boss_no}</h3>
                <span className="text-[10px] text-gray-400">{state.boss_attacks_left} {t('clanAttacksLeft')}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-500" style={{ width: `${Math.max(0, (state.boss.hp / Math.max(1, state.boss.max_hp)) * 100)}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-gray-400">{state.boss.hp.toLocaleString()} / {state.boss.max_hp.toLocaleString()} HP · {t('clanMyDamage')}: {state.my_boss_damage.toLocaleString()}</p>
              <div className="mt-2 flex gap-2">
                {state.boss.hp > 0 && state.boss_attacks_left > 0 && (
                  <button disabled={busy} onClick={() => void simple(() => clanBossAttack(clanId!), () => loadState(clanId!))} className="flex-1 rounded-xl bg-gradient-to-b from-red-500 to-red-700 py-2 text-xs font-extrabold text-white active:scale-95 transition-transform">{t('clanAttackBoss')}</button>
                )}
                {state.boss.hp <= 0 && !state.boss_claimed && state.my_boss_damage > 0 && (
                  <button disabled={busy} onClick={doBossClaim} className="flex-1 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 py-2 text-xs font-extrabold text-black active:scale-95 transition-transform">{t('clanClaim')}</button>
                )}
                {state.boss_claimed && <span className="flex-1 py-2 text-center text-xs font-bold text-emerald-400">{t('clanClaimed')}</span>}
              </div>
            </div>
          )}
          {!state.boss && (
            <button disabled={busy} onClick={() => void simple(() => clanBossSync(clanId!), () => loadState(clanId!))} className="w-full rounded-2xl border border-dashed border-red-500/40 bg-red-950/10 py-3 text-xs font-bold text-red-300 active:scale-95 transition-transform">
              {t('clanSpawnBoss')}
            </button>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <h3 className="mb-2 text-sm font-bold text-white">{t('clanBuildings')}</h3>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(state.buildings).map(([key, b]) => (
                <button
                  key={key}
                  disabled={busy}
                  onClick={() => void simple(() => clanBuildingUpgrade(clanId!, key), () => loadState(clanId!))}
                  className="rounded-xl border border-white/10 bg-black/30 p-2 text-center active:scale-95 transition-transform"
                >
                  <p className="text-lg">{key === 'hall' ? '🏰' : key === 'forge' ? '⚒️' : key === 'library' ? '📚' : key === 'treasury' ? '💰' : key === 'tower' ? '🗼' : '🗿'}</p>
                  <p className="text-[10px] font-bold text-white">{t(`clanB_${key}`) || key}</p>
                  <p className="text-[9px] text-amber-300">{t('clanLvl')} {b.lvl}</p>
                </button>
              ))}
            </div>
            <button disabled={busy} onClick={() => void simple(() => clanBuildingCollect(clanId!), () => loadState(clanId!))} className="mt-2 w-full rounded-xl bg-emerald-500/20 border border-emerald-400/40 py-1.5 text-xs font-bold text-emerald-200 active:scale-95 transition-transform">{t('clanCollect')}</button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <h3 className="mb-2 text-sm font-bold text-white">{t('clanQuests')}</h3>
            {state.quests.length === 0 && <p className="text-[11px] text-gray-500">{t('clanNoQuests')}</p>}
            {state.quests.map((q) => (
              <div key={q.id} className="mb-2 flex items-center gap-2 rounded-xl bg-black/30 p-2 last:mb-0">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-bold text-white">{t(`clanQ_${q.id}`)}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, (q.progress / Math.max(1, q.target)) * 100)}%` }} />
                  </div>
                </div>
                {q.claimed ? (
                  <span className="text-[10px] font-bold text-emerald-400">{t('clanClaimed')}</span>
                ) : q.progress >= q.target ? (
                  <button disabled={busy} onClick={() => doQuestClaim(q.id)} className="rounded-lg bg-amber-500/20 border border-amber-400/40 px-2.5 py-1 text-[11px] font-bold text-amber-200 active:scale-95 transition-transform">{t('clanClaim')}</button>
                ) : (
                  <span className="text-[10px] text-gray-500">{q.progress}/{q.target}</span>
                )}
              </div>
            ))}
          </div>

          {state.war && (
            <div className="rounded-2xl border border-purple-500/30 bg-purple-950/20 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-purple-200"><Swords className="w-4 h-4" /> {t('clanWar')} — {state.war.enemy_name} [{state.war.enemy_tag}]</h3>
              <div className="flex items-center justify-between text-center">
                <div className="flex-1">
                  <p className="text-lg font-extrabold text-amber-300">{state.war.my_side === 'a' ? state.war.score_a : state.war.score_b}</p>
                  <p className="text-[9px] text-gray-400">{t('clanYourSide')}</p>
                </div>
                <p className="text-xs font-bold text-gray-500">VS</p>
                <div className="flex-1">
                  <p className="text-lg font-extrabold text-red-300">{state.war.my_side === 'a' ? state.war.score_b : state.war.score_a}</p>
                  <p className="text-[9px] text-gray-400">{state.war.enemy_tag}</p>
                </div>
              </div>
              <button disabled={busy || state.my_war_strikes_today >= 5} onClick={() => void simple(() => clanWarStrike(clanId!), () => loadState(clanId!))} className="mt-2 w-full rounded-xl bg-gradient-to-b from-purple-500 to-purple-700 py-2 text-xs font-extrabold text-white active:scale-95 transition-transform disabled:opacity-40">
                {t('clanWarStrike')} ({state.my_war_strikes_today}/5)
              </button>
            </div>
          )}
          {!state.war && state.my_role !== 'member' && (
            <button disabled={busy} onClick={() => void simple(() => clanWarSignup(clanId!), () => loadState(clanId!))} className="w-full rounded-2xl border border-dashed border-purple-500/40 bg-purple-950/10 py-3 text-xs font-bold text-purple-300 active:scale-95 transition-transform">
              {t('clanWarSignup')}
            </button>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
            <h3 className="border-b border-white/10 p-3 pb-2 text-sm font-bold text-white">{t('clanMembers')} ({state.clan.members})</h3>
            {state.members.map((m) => {
              const canManage = (state.my_role === 'leader' && m.role !== 'leader') || (state.my_role === 'deputy' && ['officer', 'veteran', 'member'].includes(m.role)) || (state.my_role === 'officer' && m.role === 'member');
              const isMe = m.player_id === userId;
              return (
                <div key={m.player_id} className="flex items-center gap-2 border-b border-white/5 p-2.5 last:border-0">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-xs">
                    {m.role === 'leader' ? <Crown className="w-4 h-4 text-amber-400" /> : m.role === 'deputy' ? <Shield className="w-3.5 h-3.5 text-sky-400" /> : '👤'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-xs font-bold text-white">
                      {m.display_name} {isMe && <span className="text-[9px] text-amber-300">({t('clanYou')})</span>}
                    </p>
                    <p className="text-[10px] text-gray-400">{t(`clanR_${m.role}`)} · {t('clanLevelShort')} {m.level} · {t('clanPower')} {m.power.toLocaleString()}</p>
                  </div>
                  {m.online && <span className="h-2 w-2 rounded-full bg-emerald-400" title={t('clanOnline')} />}
                  {canManage && !isMe && (
                    <div className="flex gap-1">
                      <button onClick={() => void simple(() => clanKick(m.player_id), () => loadState(clanId!))} className="rounded-lg bg-red-500/15 border border-red-400/30 px-2 py-1 text-[10px] font-bold text-red-300">{t('clanKick')}</button>
                      {state.my_role === 'leader' && (
                        <button onClick={() => void simple(() => clanTransfer(m.player_id), () => loadState(clanId!))} className="rounded-lg bg-amber-500/15 border border-amber-400/30 px-2 py-1 text-[10px] font-bold text-amber-300">{t('clanTransfer')}</button>
                      )}
                      {(state.my_role === 'leader' || state.my_role === 'deputy') && (
                        <button onClick={() => void simple(() => clanSetRole(m.player_id, m.role === 'officer' ? 'member' : 'officer'), () => loadState(clanId!))} className="rounded-lg bg-sky-500/15 border border-sky-400/30 px-2 py-1 text-[10px] font-bold text-sky-300">
                          {m.role === 'officer' ? '↓' : '↑'}
                        </button>
                      )}
                      {['leader', 'deputy', 'officer'].includes(state.my_role) && (
                        <button onClick={() => void simple(() => clanChatMute(clanId!, m.player_id, 30), () => loadState(clanId!))} className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[10px] font-bold text-gray-300">🔇</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button disabled={busy} onClick={() => void run(doLeave)} className="m-3 w-[calc(100%-24px)] rounded-xl border border-red-400/40 bg-red-500/10 py-2 text-xs font-bold text-red-300">{t('clanLeave')}</button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] flex flex-col">
            <h3 className="border-b border-white/10 p-3 pb-2 text-sm font-bold text-white">{t('clanChat')}</h3>
            <div className="max-h-64 space-y-2 overflow-y-auto p-3">
              {state.chat.length === 0 && <p className="text-[11px] text-gray-500">{t('clanNoChat')}</p>}
              {state.chat.map((msg) => (
                <div key={msg.id} className={`rounded-xl p-2 ${msg.kind !== 'chat' ? 'bg-amber-500/10 border border-amber-400/20' : msg.author_id === userId ? 'bg-sky-500/10 border border-sky-400/20' : 'bg-black/30'}`}>
                  <p className="text-[10px] font-bold text-gray-300">
                    {msg.kind !== 'chat' ? `📜 ${t(`clanK_${msg.kind}`) || msg.kind}` : msg.author_name}
                    <span className="ml-1 font-normal text-gray-500">{new Date(msg.created_at).toLocaleTimeString(language === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  <p className="text-xs leading-relaxed text-white">{msg.body}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t border-white/10 p-2">
              <input
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value.slice(0, 300))}
                onKeyDown={(e) => { if (e.key === 'Enter') void doSendChat(); }}
                placeholder={t('clanChatPh')}
                className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-amber-400/50 focus:outline-none"
              />
              <button disabled={busy || !chatDraft.trim()} onClick={doSendChat} className="rounded-xl bg-amber-500/20 border border-amber-400/40 px-3 text-amber-200 active:scale-95 transition-transform disabled:opacity-40"><Send className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      {view === 'detail' && !state && <p className="py-12 text-center text-sm text-gray-400">{t('loadingHero')}</p>}

      {view === 'rankings' && rankings && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setView('home')} className="rounded-xl border border-white/10 bg-white/5 p-2 text-gray-300"><ChevronLeft className="w-4 h-4" /></button>
            <h2 className="text-base font-bold text-white">{t('clanRankings')}</h2>
          </div>
          {rankings.clans.map((c, i) => (
            <div key={c.id} className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${c.id === dir?.my_clan_id ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10 bg-white/[0.04]'}`}>
              <span className={`w-7 text-center text-sm font-extrabold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-orange-400' : 'text-gray-500'}`}>{i + 1}</span>
              <Emblem emblem={c.emblem} color1={c.color1} color2={c.color2} size={30} />
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-bold text-white">{c.name} <span style={{ color: c.color1 }}>[{c.tag}]</span></p>
                <p className="text-[10px] text-gray-400">{t('clanLevelShort')} {c.level} · {c.members} {t('clanMembersShort')}</p>
              </div>
              <span className="text-xs font-bold text-amber-300">{c.rating}</span>
            </div>
          ))}
        </div>
      )}

      {dir && !dir.my_clan_id && view === 'home' && rankings === null && (
        <button onClick={openBrowse} className="sr-only">{t('clanFind')}</button>
      )}
      <button onClick={() => { if (view === 'home') { setView('rankings'); } }} className={view === 'home' ? '' : 'sr-only'}>
        <ScrollText className="w-0 h-0" />
      </button>
    </div>
  );
}
