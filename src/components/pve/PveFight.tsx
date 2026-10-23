import { useCallback, useEffect, useRef, useState } from 'react';
import { Shield, Sword, Check, Flag, Loader2, Trophy } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame, useArena, recordBattleResult } from '@/game/actions';
import { ZONES, type Zone } from '@/game/arenaApi';
import { beltContext, consumeBelt } from '@/game/belt';
import { blessedGold, consumeBlessing, recordTrialWin, trialReward } from '@/game/progression';
import { selectedFollower, followerCombat } from '@/game/followers';
import { applyPotion, describeHit, enemySide, heroSide, playRound, randomZones, type PveSide } from '@/game/pve';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import type { Enemy } from '@/game/types';
import { getCombatAppearance } from '@/game/appearance';
import { getEnemyCombatFrames, getFollowerArt, getFollowerCombatFrames, resolveCombatArtUrl } from '@/game/combatArt';
import { hapticImpact } from '@/game/telegram';
import { FighterFigure } from '@/components/arena/FighterFigure';
import { VictorySparks } from '@/components/arena/VictorySparks';
import { FoldSection } from '@/components/arena/FoldSection';
import { GearStrip } from '@/components/arena/GearStrip';
import { BeltCells } from '@/components/ui/BeltCells';
import { Currency } from '@/components/ui/Currency';
import { useLanguage, localizeText } from '@/game/i18n';
import { beginReferralFight, finishReferralFight, type ReferralRound } from '@/game/referrals';
import { captureGameEvent } from '@/game/analytics';

export type FightKind = 'stage' | 'trial';

interface Props {
  enemy: Enemy;
  kind: FightKind;
  onExit: () => void;
  onNext?: () => void;
}

interface Outcome {
  won: boolean;
  gold: number;
  xp: number;
  gems: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Plate({ side, tone }: { side: PveSide; tone: 'ally' | 'enemy' }) {
  const pct = Math.max(0, (side.hp / side.maxHp) * 100);
  const low = pct <= 30;
  return (
    <div className="w-full rounded-lg bg-black/60 backdrop-blur-sm px-2 py-1 border border-white/10">
      <p className={`text-[11px] font-semibold truncate ${tone === 'ally' ? 'text-teal-200' : 'text-red-200'}`}>{side.name}</p>
      <div className="h-1.5 rounded-full bg-black/60 overflow-hidden mt-0.5">
        <div
          className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${
            low ? 'from-red-500 to-orange-400' : tone === 'ally' ? 'from-emerald-500 to-teal-300' : 'from-red-600 to-red-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-gray-200 tabular-nums text-right leading-tight mt-0.5">{side.hp}/{side.maxHp}</p>
    </div>
  );
}

function ZoneBtn({ label, sub, on, tone, disabled, onClick }: { label: string; sub?: string; on: boolean; tone: 'def' | 'atk'; disabled: boolean; onClick: () => void }) {
  const Icon = tone === 'def' ? Shield : Sword;
  const active = tone === 'def'
    ? 'bg-sky-500/35 border-sky-300 text-white shadow-[0_0_14px_rgba(56,189,248,0.45)]'
    : 'bg-red-500/35 border-red-300 text-white shadow-[0_0_14px_rgba(248,113,113,0.45)]';
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full h-11 rounded-xl border flex flex-col items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-40 ${
        on ? active : 'bg-black/55 border-white/15 text-gray-200 backdrop-blur-sm'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${on ? '' : tone === 'def' ? 'text-sky-300' : 'text-red-300'}`} />
      <span className="text-[10px] font-semibold leading-tight">{label}</span>
      {sub && <span className="text-[8px] leading-none text-gray-300">{sub}</span>}
    </button>
  );
}

export function PveFight({ enemy, kind, onExit, onNext }: Props) {
  const { language } = useLanguage();
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const follower = selectedFollower(state);
  const followerBonus = followerCombat(follower);
  const [hero, setHero] = useState<PveSide>(() => heroSide(useGame.get()));
  const [foe, setFoe] = useState<PveSide>(() => enemySide(enemy));
  const [attack, setAttack] = useState<Zone | null>(null);
  const [blocks, setBlocks] = useState<Zone[]>([]);
  const [busy, setBusy] = useState(false);
  const [strike, setStrike] = useState<StrikeEvent | null>(null);
  const [log, setLog] = useState<string[]>([language === 'en' ? `Battle started: ${localizeText(enemy.name, language)}` : `Бой начался: ${enemy.name}`]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [gearOpen, setGearOpen] = useState(false);
  const alive = useRef(true);
  const done = useRef(false);
  const keyRef = useRef(0);
  const heroRef = useRef(hero);
  const foeRef = useRef(foe);
  // Only a newly invited Telegram account receives server-recorded battle receipts.
  const referralRounds = useRef<ReferralRound[]>([]);
  const referralStart = useRef<Promise<string | null> | null>(null);
  const referralFinish = useRef<Promise<unknown>>(Promise.resolve());
  const nextRequested = useRef(false);
  heroRef.current = hero;
  foeRef.current = foe;

  const { speed, auto } = state.settings;
  const setSettings = (patch: Partial<typeof state.settings>) =>
    useGame.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  useEffect(() => {
    referralStart.current = beginReferralFight(kind, enemy.id);
    return () => { alive.current = false; };
  }, [kind, enemy.id]);

  const pushLog = (line: string) => setLog((l) => [line, ...l].slice(0, 30));

  const finish = useCallback((won: boolean) => {
    if (done.current) return;
    done.current = true;
    captureGameEvent('territory_pve_fight_end', { mode: kind === 'trial' ? 'trial' : 'campaign', outcome: won ? 'won' : 'lost' });
    referralFinish.current = (referralStart.current ?? Promise.resolve(null))
      .then(ticket => ticket
        ? finishReferralFight(ticket, won, referralRounds.current).catch(() => false)
        : false);
    if (!won) {
      setOutcome({ won: false, gold: 0, xp: 0, gems: 0 });
      return;
    }
    const s = useGame.get();
    if (kind === 'trial') {
      const r = trialReward(s.trialLevel);
      useGame.set(recordTrialWin(s, enemy));
      setOutcome({ won: true, gold: r.gold ?? 0, xp: enemy.rewardXp, gems: r.gems ?? 0 });
      return;
    }
    const gold = blessedGold(s, enemy.rewardGold);
    useGame.set(recordBattleResult(consumeBlessing(s), enemy, { gold, xp: enemy.rewardXp }));
    setOutcome({ won: true, gold, xp: enemy.rewardXp, gems: 0 });
  }, [enemy, kind]);

  const runRound = useCallback(async (atk: Zone, blk: Zone[]) => {
    if (busy || outcome) return;
    setBusy(true);
    referralRounds.current.push({ attack: atk, blocks: [...blk] });
    hapticImpact('light');
    const res = playRound(heroRef.current, foeRef.current, atk, blk, followerBonus.attack, follower?.name ?? '', followerBonus.defense, followerBonus);
    const pace = 1 / useGame.get().settings.speed;
    for (const hit of res.hits) {
      if (!alive.current || done.current) return;
      setStrike({ key: ++keyRef.current, attacker: hit.attacker, target: hit.target, tone: hit.tone, amount: hit.amount || null });
      await wait(350 * pace);
      if (!alive.current) return;
      if (hit.targetSide === 'enemy') setFoe((f) => ({ ...f, hp: Math.max(0, f.hp - hit.amount) }));
      else setHero((h) => ({ ...h, hp: Math.max(0, h.hp - hit.amount) }));
      pushLog(describeHit(hit));
      await wait(520 * pace);
    }
    if (!alive.current) return;
    if (res.healAmount > 0) {
      setHero((h) => ({ ...h, hp: Math.min(h.maxHp, h.hp + res.healAmount) }));
      pushLog(language === 'en' ? `Companion healed ${res.healAmount} HP` : `Спутник восстановил ${res.healAmount} HP`);
    }
    setStrike(null);
    setBusy(false);
    setAttack(null);
    setBlocks([]);
    if (res.enemy.hp <= 0) finish(true);
    else if (res.hero.hp <= 0) finish(false);
  }, [busy, outcome, follower, followerBonus.attack, followerBonus.defense, followerBonus.heal, followerBonus.crit, followerBonus.pierce, finish, language]);

  useEffect(() => {
    if (!auto || busy || outcome) return;
    const t = setTimeout(() => {
      const z = randomZones();
      runRound(z.attack, z.blocks);
    }, 350 / speed);
    return () => clearTimeout(t);
  }, [auto, busy, outcome, speed, runRound]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleBlock = (z: Zone) =>
    setBlocks((b) => (b.includes(z) ? b.filter((x) => x !== z) : b.length < 2 ? [...b, z] : [b[1], z]));

  const drinkPotion = (i: number, open: boolean) => {
    const item = state.belt[i];
    if (!open) return setToast(language === 'en' ? 'This belt slot is still locked' : 'Этот слот пояса ещё закрыт');
    if (!item) return setToast(language === 'en' ? 'Empty slot — move an elixir from inventory' : 'Слот пуст — положи эликсир из инвентаря');
    if (busy || outcome) return;
    const r = applyPotion(heroRef.current, item);
    setToast(r.text);
    if (!r.ok) return;
    setHero(r.hero);
    pushLog(`${item.name}: ${r.text}`);
    useGame.set((s) => consumeBelt(s, i));
  };

  const controls = !busy && !outcome && !auto;
  const ready = controls && !!attack && blocks.length === 2;
  const hint = auto ? (language === 'en' ? 'Auto-battle: zones are selected automatically' : 'Автобой: зоны выбираются сами')
    : blocks.length < 2 ? (language === 'en' ? `Choose ${2 - blocks.length} more defense zone(s)` : `Защита: выбери ещё ${2 - blocks.length}`) : !attack ? (language === 'en' ? 'Choose an attack zone' : 'Выбери зону удара') : (language === 'en' ? 'Press STRIKE' : 'Жми УДАР');

  return (
    <div className="space-y-2 animate-fade-in">
      <div className="flex items-center gap-2 h-10">
        <button
          onClick={() => (outcome ? onExit() : finish(false))}
          className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-gray-200 flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <Flag className="w-3.5 h-3.5" /> {outcome ? (language === 'en' ? 'Map' : 'К карте') : (language === 'en' ? 'Surrender' : 'Сдаться')}
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-[10px] uppercase tracking-wider text-amber-300/80">{kind === 'trial' ? (language === 'en' ? `Trial ${state.trialLevel}` : `Испытание ${state.trialLevel}`) : enemy.isBoss ? (language === 'en' ? 'Chapter boss' : 'Босс главы') : (language === 'en' ? `Chapter ${state.currentChapter}` : `Глава ${state.currentChapter}`)}</p>
          <p className="text-sm font-bold text-white truncate">{enemy.name}</p>
        </div>
        <span className="h-9 px-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center">
          <Currency kind="stones" value={state.battleStones} size={18} className="text-xs text-amber-100" />
        </span>
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-xl shadow-black/40">
        <img
          src={import.meta.env.BASE_URL + (kind === 'trial' ? 'map-chamber.webp' : 'assets/territory/scenes/arena-viking.webp')}
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = import.meta.env.BASE_URL + 'arena-bg.webp';
          }}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover ${kind === 'trial' ? 'object-center saturate-[1.18] contrast-[1.08]' : 'object-[center_62%]'}`}
        />
        <div className={`absolute inset-0 pointer-events-none ${
          kind === 'trial'
            ? 'bg-gradient-to-b from-[#07122b]/45 via-[#182356]/20 to-[#100d28]/80'
            : 'bg-gradient-to-b from-black/30 via-black/10 to-black/85'
        }`} />
        {kind === 'trial' && (
          <>
            <span aria-hidden="true" className="trial-magic-glow absolute inset-x-[18%] top-[22%] h-[28%] rounded-full bg-cyan-400/20 blur-3xl pointer-events-none" />
            <span aria-hidden="true" className="trial-magic-glow absolute inset-x-[25%] bottom-0 h-[18%] rounded-full bg-violet-400/20 blur-2xl pointer-events-none" />
            <div className="pointer-events-none absolute inset-0 border-2 border-violet-300/20 rounded-2xl" />
          </>
        )}

        <div className="relative grid grid-cols-[52px_1fr_52px] gap-1.5 p-2 pt-3">
          <div className="flex flex-col gap-1.5 pt-5">
            <p className="text-[9px] uppercase tracking-wider text-sky-200 text-center font-semibold">{language === 'en' ? 'DEFENSE' : 'Защита'}</p>
            {ZONES.map((z) => (
              <ZoneBtn key={z.id} label={language === 'en' ? ({ head: 'Head', chest: 'Chest', belly: 'Belly', legs: 'Legs' } as Record<string, string>)[z.id] : z.label} tone="def" on={blocks.includes(z.id)} disabled={!controls} onClick={() => toggleBlock(z.id)} />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1 min-h-[240px]">
            <div className="flex flex-col min-w-0">
              <Plate side={hero} tone="ally" />
              <div className="relative flex-1 mt-1">
                {follower && (
                  <div className="absolute -left-[8%] bottom-0 z-10 h-[52%] w-[48%] pointer-events-none">
                    <FighterFigure
                      src={getFollowerArt(follower.id)}
                      combatFrames={getFollowerCombatFrames(follower.id)}
                      name={follower.name}
                      dir={1}
                      alive={hero.hp > 0}
                      strike={strike}
                      idleSeconds={3.7}
                      className="absolute left-0 bottom-0 h-full w-full object-contain object-left-bottom"
                    />
                  </div>
                )}
                <div className="absolute inset-0 z-20 pointer-events-none">
                  <FighterFigure
                    src={import.meta.env.BASE_URL + 'assets/territory/characters/heroes/male_viking/idle.webp'}
                    combatFrames={getCombatAppearance(state.appearance)}
                    name={hero.name}
                    dir={1}
                    alive={hero.hp > 0}
                    strike={strike}
                    idleSeconds={3.1}
                    className="absolute right-0 bottom-0 h-[98%] w-full object-contain object-right-bottom"
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col min-w-0">
              <Plate side={foe} tone="enemy" />
              <div className="relative flex-1 mt-1">
                <FighterFigure
                  src={resolveCombatArtUrl(enemy.art)}
                  combatFrames={getEnemyCombatFrames(enemy.art)}
                  name={foe.name}
                  dir={-1}
                  alive={foe.hp > 0}
                  strike={strike}
                  idleSeconds={2.8}
                  className={`absolute left-0 bottom-0 object-contain object-left-bottom ${enemy.isBoss ? 'h-[96%] w-[100%]' : 'h-[78%] w-[80%]'}`}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pt-5">
            <p className="text-[9px] uppercase tracking-wider text-red-200 text-center font-semibold">{language === 'en' ? 'ATTACK' : 'Удар'}</p>
            {ZONES.map((z) => (
              <ZoneBtn key={z.id} label={language === 'en' ? ({ head: 'Head', chest: 'Chest', belly: 'Belly', legs: 'Legs' } as Record<string, string>)[z.id] : z.label} sub={z.mult !== 1 ? `×${z.mult}` : undefined} tone="atk" on={attack === z.id} disabled={!controls} onClick={() => setAttack(z.id)} />
            ))}
          </div>
        </div>

        {!outcome && (
          <div className="relative px-2 pb-2">
            <p className="text-[11px] text-gray-200 text-center h-4 mb-1 truncate">{toast ?? hint}</p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSettings({ auto: !auto })}
                className="shrink-0 flex items-center gap-1.5 h-11 px-2 rounded-xl bg-black/55 border border-white/15 backdrop-blur-sm"
              >
                <span className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${auto ? 'bg-amber-400 border-amber-400' : 'border-white/40'}`}>
                  {auto && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
                </span>
                <span className="text-[10px] font-semibold text-gray-100 leading-tight text-left">{language === 'en' ? <>Auto<br />battle</> : <>Авто<br />бой</>}</span>
              </button>
              <button
                disabled={!ready}
                onClick={() => attack && runRound(attack, blocks)}
                className={`flex-1 min-w-0 h-11 rounded-xl font-black tracking-[0.2em] text-base flex items-center justify-center gap-2 transition-all active:scale-[0.97] disabled:opacity-40 bg-gradient-to-b from-red-500 to-red-700 text-white border border-red-300/40 ${ready ? 'animate-strike-ready' : ''}`}
              >
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sword className="w-5 h-5" />} {language === 'en' ? 'STRIKE' : 'УДАР'}
              </button>
              <button
                onClick={() => setSettings({ speed: speed === 1 ? 2 : 1 })}
                aria-label={language === 'en' ? 'Battle speed' : 'Скорость боя'}
                className={`shrink-0 w-11 h-11 rounded-xl border text-sm font-black transition-colors ${speed === 2 ? 'bg-amber-400 text-black border-amber-300' : 'bg-black/55 text-gray-100 border-white/15'}`}
              >
                x2
              </button>
            </div>
          </div>
        )}

        {outcome && <OutcomePanel outcome={outcome} kind={kind} onExit={onExit}
          onNext={onNext ? () => {
            if (nextRequested.current) return;
            nextRequested.current = true;
            // Never hold up normal combat if Supabase is temporarily offline.
            void Promise.race([
              referralFinish.current.catch(() => false),
              new Promise(resolve => setTimeout(resolve, 1400)),
            ]).then(onNext);
          } : undefined} />}
      </div>

      {!outcome && (
        <div className="rounded-xl border border-amber-500/15 bg-gray-900/70 p-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">{language === 'en' ? 'Elixir belt' : 'Пояс с эликсирами'}</p>
          <BeltCells belt={state.belt} ctx={beltContext(state, arena.wins)} disabled={busy} onTap={drinkPotion} />
        </div>
      )}

      <FoldSection title={language === 'en' ? 'Equipment' : 'Снаряжение'} summary={`${Object.keys(state.player.equipped).length}/7`} open={gearOpen} onToggle={() => setGearOpen((v) => !v)}>
        <GearStrip equipped={state.player.equipped} />
      </FoldSection>

      <div className="rounded-xl border border-white/10 bg-black/30 p-2 max-h-32 overflow-y-auto scrollbar-hide">
        {log.map((line, i) => (
          <p key={log.length - i} className={`text-[11px] leading-relaxed ${i === 0 ? 'text-gray-100' : 'text-gray-500'}`}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function OutcomePanel({ outcome, kind, onExit, onNext }: { outcome: Outcome; kind: FightKind; onExit: () => void; onNext?: () => void }) {
  const { language } = useLanguage();
  return (
    <div className="relative px-3 pb-3 pt-1 animate-pop">
      <div className={`relative overflow-hidden rounded-2xl border p-3 text-center backdrop-blur-md ${outcome.won ? 'bg-amber-950/80 border-amber-400/60 shadow-[0_0_22px_rgba(245,158,11,0.15)]' : 'bg-red-950/70 border-red-400/40'}`}>
        {outcome.won && <VictorySparks />}
        {outcome.won && <Trophy aria-hidden="true" className="relative mx-auto mb-1.5 h-9 w-9 text-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.7)]" />}
        <p className={`relative text-[22px] font-black tracking-[0.08em] ${outcome.won ? 'text-amber-300' : 'text-red-300'}`}>{outcome.won ? (language === 'en' ? 'VICTORY' : 'ПОБЕДА') : (language === 'en' ? 'DEFEAT' : 'ПОРАЖЕНИЕ')}</p>
        {outcome.won ? (
          <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-sm text-white">
            <Currency kind="gold" value={`+${outcome.gold}`} size={18} />
            <span className="font-semibold text-sky-200">+{outcome.xp} {language === 'en' ? 'XP' : 'опыта'}</span>
            {outcome.gems > 0 && <Currency kind="gems" value={`+${outcome.gems}`} size={18} />}
          </div>
        ) : (
          <p className="text-xs text-gray-300 mt-1.5">{language === 'en' ? 'Upgrade your gear in the Forge or equip elixirs and try again.' : 'Улучши снаряжение в Кузнице или возьми эликсиры в пояс и попробуй снова.'}</p>
        )}
        <div className="flex gap-2 mt-3">
          <button onClick={onExit} className="flex-1 h-10 rounded-xl bg-white/10 border border-white/15 text-sm font-semibold text-white active:scale-95 transition-transform">
            {kind === 'trial' ? (language === 'en' ? 'Trials' : 'К испытаниям') : (language === 'en' ? 'Map' : 'К карте')}
          </button>
          {outcome.won && onNext && (
            <button onClick={onNext} className="flex-1 h-10 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-sm font-bold text-black active:scale-95 transition-transform">
              {language === 'en' ? 'Next fight' : 'Следующий бой'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
