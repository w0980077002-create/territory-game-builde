import { useCallback, useEffect, useRef, useState } from 'react';
import { Shield, Sword, Check, Flag, Loader2 } from 'lucide-react';
import { assetUrl } from '@/game/assets';
import { useStore } from '@/game/store';
import { useGame, useArena } from '@/game/actions';
import { ZONES, type Zone } from '@/game/arenaApi';
import { beltContext, consumeBelt } from '@/game/belt';
import { claimPveWin } from '@/game/pveApi';
import { applyPotion, describeHit, enemySide, heroSide, playRound, randomZones, type PveSide } from '@/game/pve';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import type { Enemy, InventoryItem } from '@/game/types';
import { hapticImpact } from '@/game/telegram';
import { FighterFigure } from '@/components/arena/FighterFigure';
import { FoldSection } from '@/components/arena/FoldSection';
import { GearStrip } from '@/components/arena/GearStrip';
import { BeltCells } from '@/components/ui/BeltCells';
import { Currency } from '@/components/ui/Currency';
import { ItemArt } from '@/components/ui/ItemArt';

export type FightKind = 'stage' | 'trial';

interface Props {
  enemy: Enemy;
  kind: FightKind;
  battleId: string;
  onExit: () => void;
  onNext?: () => void;
}

interface Outcome {
  won: boolean;
  gold: number;
  xp: number;
  gems: number;
  loot?: InventoryItem;
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

export function PveFight({ enemy, kind, battleId, onExit, onNext }: Props) {
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const follower = state.followers.find((f) => f.unlocked);
  const [hero, setHero] = useState<PveSide>(() => heroSide(useGame.get()));
  const [foe, setFoe] = useState<PveSide>(() => enemySide(enemy));
  const [attack, setAttack] = useState<Zone | null>(null);
  const [blocks, setBlocks] = useState<Zone[]>([]);
  const [busy, setBusy] = useState(false);
  const [strike, setStrike] = useState<StrikeEvent | null>(null);
  const [log, setLog] = useState<string[]>([`Бой начался: ${enemy.name}`]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [gearOpen, setGearOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const alive = useRef(true);
  const done = useRef(false);
  const keyRef = useRef(0);
  const heroRef = useRef(hero);
  const foeRef = useRef(foe);
  heroRef.current = hero;
  foeRef.current = foe;

  const { speed, auto } = state.settings;
  const setSettings = (patch: Partial<typeof state.settings>) =>
    useGame.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  useEffect(() => () => { alive.current = false; }, []);

  const pushLog = (line: string) => setLog((l) => [line, ...l].slice(0, 30));

  const finish = useCallback(async (won: boolean) => {
    if (done.current) return;
    done.current = true;
    if (!won) {
      setOutcome({ won: false, gold: 0, xp: 0, gems: 0 });
      return;
    }
    setClaiming(true);
    try {
      const result = await claimPveWin(battleId);
      useGame.set(result.gameState);
      setOutcome({
        won: true,
        gold: result.gold,
        xp: result.xp,
        gems: result.gems,
        loot: result.loot ?? undefined,
      });
    } catch (err) {
      done.current = false;
      setToast(err instanceof Error ? err.message : 'Не удалось получить награду. Нажми УДАР ещё раз.');
    } finally {
      setClaiming(false);
    }
  }, [battleId]);

  const runRound = useCallback(async (atk: Zone, blk: Zone[]) => {
    if (busy || outcome || claiming) return;
    setBusy(true);
    hapticImpact('light');
    const res = playRound(heroRef.current, foeRef.current, atk, blk, follower?.attack ?? 0, follower?.name ?? '');
    const pace = 1 / useGame.get().settings.speed;
    for (const hit of res.hits) {
      if (!alive.current || done.current) return;
      setStrike({ key: ++keyRef.current, attacker: hit.attacker, target: hit.target, tone: hit.tone, amount: hit.amount || null });
      await wait(420 * pace);
      if (!alive.current) return;
      if (hit.targetSide === 'enemy') setFoe((f) => ({ ...f, hp: Math.max(0, f.hp - hit.amount) }));
      else setHero((h) => ({ ...h, hp: Math.max(0, h.hp - hit.amount) }));
      pushLog(describeHit(hit));
      await wait(620 * pace);
    }
    if (!alive.current) return;
    setStrike(null);
    setBusy(false);
    setAttack(null);
    setBlocks([]);
    if (res.enemy.hp <= 0) finish(true);
    else if (res.hero.hp <= 0) finish(false);
  }, [busy, outcome, follower, finish]);

  useEffect(() => {
    if (!auto || busy || outcome || claiming) return;
    const t = setTimeout(() => {
      const z = randomZones();
      runRound(z.attack, z.blocks);
    }, 350 / speed);
    return () => clearTimeout(t);
  }, [auto, busy, outcome, claiming, speed, runRound]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleBlock = (z: Zone) =>
    setBlocks((b) => (b.includes(z) ? b.filter((x) => x !== z) : b.length < 2 ? [...b, z] : [b[1], z]));

  const drinkPotion = (i: number, open: boolean) => {
    const item = state.belt[i];
    if (!open) return setToast('Этот слот пояса ещё закрыт');
    if (!item) return setToast('Слот пуст — положи эликсир из инвентаря');
    if (busy || outcome || claiming) return;
    const r = applyPotion(heroRef.current, item);
    setToast(r.text);
    if (!r.ok) return;
    setHero(r.hero);
    pushLog(`${item.name}: ${r.text}`);
    useGame.set((s) => consumeBelt(s, i));
  };

  const controls = !busy && !outcome && !auto && !claiming;
  const ready = controls && !!attack && blocks.length === 2;
  const hint = auto ? 'Автобой: зоны выбираются сами'
    : blocks.length < 2 ? `Защита: выбери ещё ${2 - blocks.length}` : !attack ? 'Выбери зону удара' : 'Жми УДАР';

  return (
    <div className="space-y-2 animate-fade-in">
      <div className="flex items-center gap-2 h-10">
        <button
          onClick={() => (outcome ? onExit() : finish(false))}
          className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-gray-200 flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <Flag className="w-3.5 h-3.5" /> {outcome ? 'К карте' : 'Сдаться'}
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-[10px] uppercase tracking-wider text-amber-300/80">{kind === 'trial' ? `Испытание ${state.trialLevel}` : enemy.isBoss ? 'Босс главы' : `Глава ${state.currentChapter}`}</p>
          <p className="text-sm font-bold text-white truncate">{enemy.name}</p>
        </div>
        <span className="h-9 px-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center">
          <Currency kind="stones" value={state.battleStones} size={18} className="text-xs text-amber-100" />
        </span>
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-xl shadow-black/40">
        <img src={assetUrl('/arena-bg.webp')} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/85" />

        <div className="relative grid grid-cols-[52px_1fr_52px] gap-1.5 p-2 pt-3">
          <div className="flex flex-col gap-1.5 pt-5">
            <p className="text-[9px] uppercase tracking-wider text-sky-200 text-center font-semibold">Защита</p>
            {ZONES.map((z) => (
              <ZoneBtn key={z.id} label={z.label} tone="def" on={blocks.includes(z.id)} disabled={!controls} onClick={() => toggleBlock(z.id)} />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1 min-h-[240px]">
            <div className="flex flex-col min-w-0">
              <Plate side={hero} tone="ally" />
              <div className="relative flex-1 mt-1">
                {follower && (
                  <img
                    src={assetUrl('/follower-shield.webp')}
                    alt={follower.name}
                    draggable={false}
                    className={`absolute -left-3 bottom-1 h-[56%] w-auto max-w-none object-contain select-none drop-shadow-[0_6px_8px_rgba(0,0,0,0.7)] ${hero.hp > 0 ? 'opacity-90 animate-idle' : 'grayscale opacity-40'}`}
                    style={{ animationDuration: '3.7s' }}
                  />
                )}
                <FighterFigure
                  src={assetUrl('/hero-viking.webp')}
                  name={hero.name}
                  dir={1}
                  alive={hero.hp > 0}
                  strike={strike}
                  idleSeconds={3.1}
                  className="absolute right-0 bottom-0 h-[88%] w-[86%] object-contain object-right-bottom"
                />
              </div>
            </div>
            <div className="flex flex-col min-w-0">
              <Plate side={foe} tone="enemy" />
              <div className="relative flex-1 mt-1">
                <FighterFigure
                  src={enemy.art}
                  name={foe.name}
                  dir={-1}
                  alive={foe.hp > 0}
                  strike={strike}
                  idleSeconds={2.8}
                  className={`absolute left-0 bottom-0 object-contain object-left-bottom ${enemy.isBoss ? 'h-[96%] w-[100%]' : 'h-[84%] w-[92%]'}`}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pt-5">
            <p className="text-[9px] uppercase tracking-wider text-red-200 text-center font-semibold">Удар</p>
            {ZONES.map((z) => (
              <ZoneBtn key={z.id} label={z.label} sub={z.mult !== 1 ? `×${z.mult}` : undefined} tone="atk" on={attack === z.id} disabled={!controls} onClick={() => setAttack(z.id)} />
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
                <span className="text-[10px] font-semibold text-gray-100 leading-tight text-left">Авто<br />бой</span>
              </button>
              <button
                disabled={!ready}
                onClick={() => attack && runRound(attack, blocks)}
                className={`flex-1 min-w-0 h-11 rounded-xl font-black tracking-[0.2em] text-base flex items-center justify-center gap-2 transition-all active:scale-[0.97] disabled:opacity-40 bg-gradient-to-b from-red-500 to-red-700 text-white border border-red-300/40 ${ready ? 'animate-strike-ready' : ''}`}
              >
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sword className="w-5 h-5" />} УДАР
              </button>
              <button
                onClick={() => setSettings({ speed: speed === 1 ? 2 : 1 })}
                aria-label="Скорость боя"
                className={`shrink-0 w-11 h-11 rounded-xl border text-sm font-black transition-colors ${speed === 2 ? 'bg-amber-400 text-black border-amber-300' : 'bg-black/55 text-gray-100 border-white/15'}`}
              >
                x2
              </button>
            </div>
          </div>
        )}

        {outcome && <OutcomePanel outcome={outcome} kind={kind} onExit={onExit} onNext={onNext} />}
      </div>

      {!outcome && (
        <div className="rounded-xl border border-amber-500/15 bg-gray-900/70 p-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Пояс с эликсирами</p>
          <BeltCells belt={state.belt} ctx={beltContext(state, arena.wins)} disabled={busy} onTap={drinkPotion} />
        </div>
      )}

      <FoldSection title="Снаряжение" summary={`${Object.keys(state.player.equipped).length}/7`} open={gearOpen} onToggle={() => setGearOpen((v) => !v)}>
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
  return (
    <div className="relative px-3 pb-3 pt-1 animate-pop">
      <div className={`rounded-2xl border p-3 text-center backdrop-blur-md ${outcome.won ? 'bg-amber-950/70 border-amber-400/40' : 'bg-red-950/70 border-red-400/40'}`}>
        <p className={`text-xl font-black tracking-wide ${outcome.won ? 'text-amber-300' : 'text-red-300'}`}>{outcome.won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}</p>
        {outcome.won ? (
          <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-sm text-white">
            <Currency kind="gold" value={`+${outcome.gold}`} size={18} />
            <span className="font-semibold text-sky-200">+{outcome.xp} опыта</span>
            {outcome.gems > 0 && <Currency kind="gems" value={`+${outcome.gems}`} size={18} />}
            {outcome.loot && (
              <span className="flex items-center gap-1 text-amber-100">
                <ItemArt item={outcome.loot} size={26} /> {outcome.loot.name}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-300 mt-1.5">Улучши снаряжение в Кузнице или возьми эликсиры в пояс и попробуй снова.</p>
        )}
        <div className="flex gap-2 mt-3">
          <button onClick={onExit} className="flex-1 h-10 rounded-xl bg-white/10 border border-white/15 text-sm font-semibold text-white active:scale-95 transition-transform">
            {kind === 'trial' ? 'К испытаниям' : 'К карте'}
          </button>
          {outcome.won && onNext && (
            <button onClick={onNext} className="flex-1 h-10 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-sm font-bold text-black active:scale-95 transition-transform">
              Следующий бой
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
