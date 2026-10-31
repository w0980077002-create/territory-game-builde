import { useCallback, useEffect, useRef, useState } from 'react';
import { Shield, Sword, Check, Flag, Loader2, Trophy } from 'lucide-react';
import { useStore } from '@/game/store';
import { getVictoryJourney, type VictoryJourney } from '@/game/victoryJourney';
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
import { runDeferredNextBattle } from '@/game/pveNextAction';

export type FightKind = 'stage' | 'trial';

interface Props {
  enemy: Enemy;
  kind: FightKind;
  onExit: () => void;
  onNext?: () => boolean;
  onQuests?: () => void;
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
  const { language } = useLanguage();
  const Icon = tone === 'def' ? Shield : Sword;
  const active = tone === 'def'
    ? 'bg-sky-500/35 border-sky-300 text-white shadow-[0_0_14px_rgba(56,189,248,0.45)]'
    : 'bg-red-500/35 border-red-300 text-white shadow-[0_0_14px_rgba(248,113,113,0.45)]';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${tone === 'def' ? (language === 'en' ? 'Defense' : 'Защита') : (language === 'en' ? 'Attack' : 'Удар')}: ${label}`}
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

export function PveFight({ enemy, kind, onExit, onNext, onQuests }: Props) {
  const { language } = useLanguage();
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const follower = selectedFollower(state);
  const followerBonus = followerCombat(follower);
  const levelAtFightStart = useRef(useGame.get().player.level);
  const [hero, setHero] = useState<PveSide>(() => heroSide(useGame.get()));
  const [foe, setFoe] = useState<PveSide>(() => enemySide(enemy));
  const [attack, setAttack] = useState<Zone | null>(null);
  const [blocks, setBlocks] = useState<Zone[]>([]);
  const [busy, setBusy] = useState(false);
  // A speed change applies to the next round. Keep the current visual contact
  // aligned with the HP update scheduled from this round's original pace.
  const [roundSpeed, setRoundSpeed] = useState(() => useGame.get().settings.speed);
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
  const nextCancelled = useRef(false);
  const [nextPending, setNextPending] = useState(false);
  const [nextError, setNextError] = useState(false);
  // React's disabled button state is not synchronous. Lock the round before
  // the first await, so two taps cannot run two local fights / referral rounds.
  const roundFlight = useRef(false);
  const lastPotionUse = useRef<{ slot: number; at: number } | null>(null);
  heroRef.current = hero;
  foeRef.current = foe;

  const { speed, auto } = state.settings;
  const setSettings = (patch: Partial<typeof state.settings>) =>
    useGame.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  useEffect(() => {
    // React StrictMode may replay effect setup/cleanup in development.
    alive.current = true;
    nextCancelled.current = false;
    referralStart.current = beginReferralFight(kind, enemy.id);
    return () => { alive.current = false; nextCancelled.current = true; };
  }, [kind, enemy.id]);

  const pushLog = (line: string) => setLog((l) => [line, ...l].slice(0, 30));

  const finish = useCallback((won: boolean) => {
    if (done.current) return;
    done.current = true;
    // Telemetry is optional: an unavailable browser API must not abort the
    // authoritative local result/save path after the final blow.
    try { captureGameEvent('territory_pve_fight_end', { mode: kind === 'trial' ? 'trial' : 'campaign', outcome: won ? 'won' : 'lost' }); }
    catch { /* Never withhold victory or a saved reward because of analytics. */ }
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
    if (roundFlight.current || busy || outcome || done.current || !alive.current) return;
    roundFlight.current = true;
    setBusy(true);
    try {
    referralRounds.current.push({ attack: atk, blocks: [...blk] });
    hapticImpact('light');
    const res = playRound(heroRef.current, foeRef.current, atk, blk, followerBonus.attack, follower?.name ?? '', followerBonus.defense, followerBonus);
    const currentSpeed = useGame.get().settings.speed;
    setRoundSpeed(currentSpeed);
    const pace = 1 / currentSpeed;
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
    setAttack(null);
    setBlocks([]);
    if (res.enemy.hp <= 0) finish(true);
    else if (res.hero.hp <= 0) finish(false);
    } finally {
      roundFlight.current = false;
      if (alive.current) setBusy(false);
    }
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
    if (roundFlight.current || busy || outcome || done.current || !alive.current) return;
    if (!open) return setToast(language === 'en' ? 'This belt slot is still locked' : 'Этот слот пояса ещё закрыт');
    // Read the current saved belt, not the one from the last React render:
    // an Android double tap must not re-use an already consumed last charge.
    const latest = useGame.get();
    const item = latest.belt[i];
    if (!item) return setToast(language === 'en' ? 'Empty slot — move an elixir from inventory' : 'Слот пуст — положи эликсир из инвентаря');
    const now = Date.now();
    if (lastPotionUse.current?.slot === i && now - lastPotionUse.current.at < 650) return;
    const r = applyPotion(heroRef.current, item);
    setToast(r.text);
    if (!r.ok) return;
    lastPotionUse.current = { slot: i, at: now };
    // Publish the new local hero state before another input event, even if
    // React has not committed the visual HP yet.
    heroRef.current = r.hero;
    useGame.set(consumeBelt(latest, i));
    setHero(r.hero);
    pushLog(`${item.name}: ${r.text}`);
  };

  const controls = !busy && !outcome && !auto;
  const ready = controls && !!attack && blocks.length === 2;
  const firstFightHelp = kind === 'stage' && state.player.level <= 2 && state.totalBattlesWon === 0;
  const victoryJourney = outcome?.won ? getVictoryJourney(state,kind,levelAtFightStart.current) : null;
  const hint = busy ? (language === 'en' ? 'Round in progress…' : 'Идёт раунд…')
    : auto ? (language === 'en' ? 'Auto-battle: zones are selected automatically' : 'Автобой: зоны выбираются сами')
    : blocks.length < 2 ? (language === 'en' ? `Choose ${2 - blocks.length} more defense zone(s)` : `Защита: выбери ещё ${2 - blocks.length}`) : !attack ? (language === 'en' ? 'Choose an attack zone' : 'Выбери зону удара') : (language === 'en' ? 'Press STRIKE' : 'Жми УДАР');

  return (
    <div className="space-y-2 animate-fade-in">
      <div className="flex items-center gap-2 h-10">
        <button
          onClick={() => {
            if (outcome) {
              nextCancelled.current = true;
              onExit();
            } else {
              finish(false);
            }
          }}
          className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-gray-200 flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <Flag className="w-3.5 h-3.5" /> {outcome ? (kind === 'trial' ? (language === 'en' ? 'Trials' : 'К испытаниям') : (language === 'en' ? 'Campaign' : 'К походу')) : (language === 'en' ? 'Surrender' : 'Сдаться')}
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-[10px] uppercase tracking-wider text-amber-300/80">{kind === 'trial' ? (language === 'en' ? `Trial ${state.trialLevel}` : `Испытание ${state.trialLevel}`) : enemy.isBoss ? (language === 'en' ? 'Chapter boss' : 'Босс главы') : (language === 'en' ? `Chapter ${state.currentChapter}` : `Глава ${state.currentChapter}`)}</p>
          <p className="text-sm font-bold text-white truncate">{enemy.name}</p>
        </div>
        <span className="h-9 px-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center">
          <Currency kind="stones" value={state.battleStones} size={18} className="text-xs text-amber-100" />
        </span>
      </div>

      {firstFightHelp && !outcome && !auto && <p className="rounded-xl border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-xs leading-relaxed text-amber-100" role="note">
        {language === 'en'
          ? 'Choose 2 defense zones on the left and 1 attack zone on the right, then press STRIKE. You can also turn on auto-battle.'
          : 'Слева выбери 2 зоны защиты, справа — 1 зону удара, затем нажми «УДАР». Можно включить автобой.'}
      </p>}

      <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-xl shadow-black/40">
        <img
          src={import.meta.env.BASE_URL + (kind === 'trial' ? 'map-chamber.webp' : 'assets/territory/scenes/arena-viking.webp')}
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = import.meta.env.BASE_URL + 'assets/territory/scenes/arena-viking.webp';
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

          <div className="relative grid grid-cols-2 gap-1 min-h-[275px]">
            <div className="flex flex-col min-w-0">
              <Plate side={hero} tone="ally" />
              <div className="relative flex-1 mt-1">
                {follower && (
                  <div className={follower.id === 'follower_6' ? 'absolute left-0 bottom-0 z-30 h-[64%] w-[64%] pointer-events-none' : 'absolute -left-[8%] bottom-0 z-10 h-[52%] w-[48%] pointer-events-none'}>
                    <FighterFigure
                      src={getFollowerArt(follower.id)}
                      combatFrames={getFollowerCombatFrames(follower.id)}
                      name={follower.name}
                      dir={1}
                      scale={1.03}
                      alive={hero.hp > 0}
                      strike={strike}
                      combatSpeed={busy || outcome ? roundSpeed : speed}
                      idleSeconds={3.7}
                      className="absolute left-0 bottom-0 h-full w-full object-contain object-left-bottom"
                    />
                  </div>
                )}
                <div className="absolute inset-0 z-20 pointer-events-none">
                  <FighterFigure
                    src={getCombatAppearance(state.appearance).idle}
                    combatFrames={getCombatAppearance(state.appearance)}
                    name={hero.name}
                    dir={1}
                    scale={1.22}
                    alive={hero.hp > 0 && outcome?.won !== false}
                    won={outcome?.won === true}
                    strike={strike}
                    combatSpeed={busy || outcome ? roundSpeed : speed}
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
                  scale={enemy.isBoss ? 1.07 : 1.1}
                  alive={foe.hp > 0}
                  won={outcome?.won === false}
                  strike={strike}
                  combatSpeed={busy || outcome ? roundSpeed : speed}
                  idleSeconds={2.8}
                  className={`absolute left-0 bottom-0 object-contain object-left-bottom ${enemy.isBoss ? 'h-[96%] w-[100%]' : 'h-[84%] w-[88%]'}`}
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
            <p className="min-h-4 mb-1 text-center text-[11px] leading-4 text-gray-200" role="status" aria-live="polite">{toast ?? hint}</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSettings({ auto: !auto })}
                aria-pressed={auto}
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

        {outcome && <OutcomePanel outcome={outcome} kind={kind} victoryJourney={victoryJourney}
          onExit={() => { nextCancelled.current = true; onExit(); }}
          questReady={state.quests.some(q => !q.claimed && q.current >= q.target)}
          onQuests={onQuests ? () => { nextCancelled.current = true; onQuests(); } : undefined}
          nextPending={nextPending} nextError={nextError}
          onNext={onNext ? () => {
            if (nextRequested.current) return;
            nextRequested.current = true;
            setNextPending(true);
            setNextError(false);
            // A late referral result must not launch a fight after Back/Quests.
            void runDeferredNextBattle(
              referralFinish.current,
              () => alive.current && !nextCancelled.current,
              onNext,
            ).then(result => {
              if (result === 'blocked' && alive.current && !nextCancelled.current) {
                nextRequested.current = false;
                setNextPending(false);
                setNextError(true);
              }
            });
          } : undefined} />}
      </div>

      {!outcome && (
        <div className="rounded-xl border border-amber-500/15 bg-gray-900/70 p-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">{language === 'en' ? 'Elixir belt' : 'Пояс с эликсирами'}</p>
          <BeltCells belt={state.belt} ctx={beltContext(state, arena.wins)} disabled={busy} onTap={drinkPotion} />
        </div>
      )}

      <FoldSection title={language === 'en' ? 'Equipment' : 'Снаряжение'} summary={`${Object.values(state.player.equipped).filter(Boolean).length}/7`} open={gearOpen} onToggle={() => setGearOpen((v) => !v)}>
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

function OutcomePanel({ outcome, kind, victoryJourney, onExit, onNext, questReady, onQuests, nextPending, nextError }: { outcome: Outcome; kind: FightKind; victoryJourney: VictoryJourney | null; onExit: () => void; onNext?: () => void; questReady: boolean; onQuests?: () => void; nextPending: boolean; nextError: boolean }) {
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
        {outcome.won && victoryJourney && (
          <section data-testid="victory-next-goal" aria-label={language === 'en' ? 'Next hero goal' : 'Следующая цель героя'}
            className="relative mt-3 rounded-xl border border-amber-300/40 bg-gradient-to-r from-[#291c18]/95 to-[#141625]/95 p-2 text-left">
            <div className="flex items-center gap-2.5">
              <div className="h-[60px] w-[58px] shrink-0 overflow-hidden rounded-lg border border-amber-500/35 bg-black/40">
                <img src={victoryJourney.enemy.art} alt="" draggable={false} loading="lazy"
                  className="h-full w-full object-contain object-bottom"/>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[.1em] text-amber-300">
                  {language === 'en' ? 'Next target' : 'Следующая цель'} · {victoryJourney.kind === 'trial'
                    ? (language === 'en' ? 'Trial ' : 'Испытание ') + victoryJourney.trialLevel
                    : victoryJourney.enemy.isBoss
                      ? (language === 'en' ? 'Chapter boss' : 'Босс главы')
                      : (language === 'en' ? 'Chapter ' : 'Глава ') + victoryJourney.chapter}
                </p>
                <p data-testid="victory-next-enemy" className="truncate text-sm font-extrabold text-[#ffe5a5]">
                  {localizeText(victoryJourney.enemy.name,language)}
                </p>
                <p className="text-[10px] text-amber-100/80">
                  {language === 'en' ? 'HP ' : 'Здоровье '}{victoryJourney.enemy.maxHp} · {language === 'en' ? 'Attack ' : 'Атака '}{victoryJourney.enemy.attack}
                </p>
              </div>
            </div>
            <div className="mt-2 border-t border-amber-300/20 pt-1.5">
              <div className="mb-1 flex justify-between gap-2 text-[11px] font-semibold">
                <span className={victoryJourney.leveledUp ? 'text-emerald-300' : 'text-amber-100'}>
                  {victoryJourney.leveledUp
                    ? (language === 'en' ? 'LEVEL UP! · Level ' : 'НОВЫЙ УРОВЕНЬ! · Ур. ') + victoryJourney.level
                    : (language === 'en' ? 'Hero level ' : 'Уровень героя ') + victoryJourney.level}
                </span>
                <span data-testid="victory-xp-label" className="text-amber-100/85 tabular-nums">
                  {victoryJourney.maxLevel ? 'MAX' : `${victoryJourney.xp}/${victoryJourney.xpToNext} XP`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/70 border border-amber-100/10"
                role="progressbar" aria-label={language === 'en' ? 'Hero experience' : 'Опыт героя'}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={victoryJourney.xpPercent}>
                <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-[width] duration-500"
                  style={{width: `${victoryJourney.xpPercent}%`}}/>
              </div>
            </div>
          </section>
        )}
        {outcome.won && questReady && onQuests && <button type="button" onClick={onQuests} className="relative mt-3 w-full min-h-11 rounded-xl border border-emerald-300/60 bg-emerald-700/70 px-3 text-sm font-bold text-white active:scale-[0.98]">
          {language === 'en' ? 'Quest reward ready — claim it' : 'Награда за задание готова — забрать'}
        </button>}
        <div className="flex gap-2 mt-3">
          <button onClick={onExit} className="flex-1 h-10 rounded-xl bg-white/10 border border-white/15 text-sm font-semibold text-white active:scale-95 transition-transform">
            {kind === 'trial' ? (language === 'en' ? 'Trials' : 'К испытаниям') : (language === 'en' ? 'Campaign' : 'К походу')}
          </button>
          {outcome.won && onNext && (
            <button type="button" onClick={onNext} disabled={nextPending} aria-busy={nextPending} className="flex-1 h-10 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-sm font-bold text-black active:scale-95 transition-transform disabled:opacity-60">
              {nextPending? (language === 'en' ? 'Starting…' : 'Начинаем…') : (language === 'en' ? 'Next fight' : 'Следующий бой')}
            </button>
          )}
        </div>
        {nextError && <p role="alert" className="mt-2 text-xs text-amber-100">
          {language === 'en' ? 'Next fight could not start. Check battle stones or recover the Dark Cave operation, then try again or return to Campaign.' : 'Следующий бой не запустился. Проверь боевые камни или восстанови операцию в Тёмной пещере. Можно повторить или вернуться в Поход.'}
        </p>}
      </div>
    </div>
  );
}
