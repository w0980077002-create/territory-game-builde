import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/game/store';
import { useGame, useArena, grantRewards, updateProgress } from '@/game/actions';
import {
  TEAM_NAMES, claimArenaReward, leaveArena, reviveAlly, submitArenaMove, applyTimePotion, drinkArenaItem,
  setArenaAuto, type ArenaReward, type Zone,
} from '@/game/arenaApi';
import { useArenaRoom, useCountdown } from '@/game/useArenaRoom';
import { useStrikeQueue } from '@/game/useStrikeQueue';
import { beltAction, beltContext, consumeBelt } from '@/game/belt';
import { hapticImpact, hapticNotify } from '@/game/telegram';
import { FighterList } from './FighterList';
import { BattleScene } from './BattleScene';
import { VictorySparks } from './VictorySparks';
import { ArenaChat } from './ArenaChat';
import { GearStrip } from './GearStrip';
import { BeltBar } from './BeltBar';
import { FoldSection } from './FoldSection';
import { equipmentArt } from '@/game/art';
import { ItemArt } from '@/components/ui/ItemArt';
import { Loader2, LogOut, Timer, WifiOff, Coins, Sparkles, Trophy, Skull, Swords } from 'lucide-react';
import { useLanguage, localizeText } from '@/game/i18n';


export function ArenaRoom({ roomId, onExit, onActiveChange }: { roomId: string; onExit: () => void; onActiveChange?: (active: boolean) => void }) {
  const { language } = useLanguage();
  const modeLabel = { duel: language === 'en' ? 'Duel 1v1' : 'Дуэль 1х1', team: language === 'en' ? 'Squad 3v3' : 'Отряд 3х3', chaos: language === 'en' ? 'Chaos' : 'Хаос' } as const;
  const teamLabel = (team: number | null | undefined) => team === 1 ? (language === 'en' ? 'Wolves' : TEAM_NAMES[1]) : team === 2 ? (language === 'en' ? 'Ravens' : TEAM_NAMES[2]) : '';
  const { view, messages, offline, clockOffset, refresh } = useArenaRoom(roomId, onExit);
  const game = useStore(useGame);
  const arenaStats = useStore(useArena);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [attack, setAttack] = useState<Zone | null>(null);
  const [blocks, setBlocks] = useState<Zone[]>([]);
  const [lastMove, setLastMove] = useState<{ attack: Zone; blocks: Zone[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reward, setReward] = useState<ArenaReward | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [beltBusy, setBeltBusy] = useState<number | null>(null);
  const [enemiesOpen, setEnemiesOpen] = useState(false);
  const [alliesOpen, setAlliesOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [beltOpen, setBeltOpen] = useState(false);
  const claiming = useRef(false);
  const prevHp = useRef<number | null>(null);

  const room = view?.room;
  const countdown = useCountdown(room ? (room.status === 'waiting' ? room.startsAt : room.deadline) : null, clockOffset);
  const me = view?.participants.find((p) => p.id === view.me.id) ?? null;
  const allies = view && me ? view.participants.filter((p) => p.team === me.team) : [];
  const enemies = view && me ? view.participants.filter((p) => p.team !== null && p.team !== me.team) : [];
  const aliveEnemies = enemies.filter((e) => e.hp > 0);
  const target = aliveEnemies.find((e) => e.id === targetId) ?? null;
  const shownEnemy = target ?? aliveEnemies[0] ?? enemies[0] ?? null;
  const alive = !!me && me.hp > 0;
  const isActive = room?.status === 'active';
  const round = room?.round ?? 0;

  useEffect(() => {
    onActiveChange?.(isActive);
    return () => onActiveChange?.(false);
  }, [isActive, onActiveChange]);
  const myHp = me?.hp ?? null;
  const strikeEvent = useStrikeQueue(messages, !!view, [me?.name ?? '', shownEnemy?.name ?? '']);

  useEffect(() => {
    if (!isActive) return;
    if (!target && aliveEnemies.length > 0) setTargetId(aliveEnemies[0].id);
  }, [isActive, target, aliveEnemies]);

  useEffect(() => {
    setAttack(null);
    setBlocks([]);
  }, [round]);

  useEffect(() => {
    if (myHp === null) return;
    if (prevHp.current !== null && myHp < prevHp.current) hapticImpact('heavy');
    prevHp.current = myHp;
  }, [myHp]);

  useEffect(() => {
    if (!view || view.room.status !== 'finished' || view.me.rewarded || claiming.current) return;
    claiming.current = true;
    claimArenaReward(roomId)
      .then((r) => {
        if (!r) return;
        let next = grantRewards(useGame.get(), r.gold, r.xp);
        if (r.won) next = updateProgress(next, 'arena_win', 1);
        useGame.set(next);
        useArena.set({ rating: r.rating, wins: r.wins, losses: r.losses });
        setReward(r);
        hapticNotify(r.won ? 'success' : r.draw ? 'warning' : 'error');
      })
      .catch(() => {
        claiming.current = false;
      });
  }, [view, roomId]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      after?.();
      refresh();
    } catch (e) {
      setActionError(localizeText((e as Error).message, language));
    }
    setBusy(false);
  };

  const toggleBlock = (z: Zone) =>
    setBlocks((b) => (b.includes(z) ? b.filter((x) => x !== z) : b.length < 2 ? [...b, z] : [b[1], z]));

  const strike = () => {
    if (!shownEnemy || shownEnemy.hp <= 0 || !attack || blocks.length !== 2) return;
    hapticImpact('medium');
    const move = { attack, blocks };
    run(() => submitArenaMove(roomId, shownEnemy.id, move.attack, move.blocks), () => setLastMove(move));
  };

  const repeatMove = () => {
    if (!lastMove) return;
    setAttack(lastMove.attack);
    setBlocks(lastMove.blocks);
  };

  const toggleAuto = () => {
    if (!view) return;
    const on = !view.me.auto;
    run(() => setArenaAuto(roomId, on));
  };

  const adrenalineSlot = game.belt.findIndex((s) => !!s && s.arenaEffect === 'adrenaline');

  const runBelt = async (index: number, fn: () => Promise<unknown>) => {
    setBeltBusy(index);
    await run(fn, () => useGame.set((s) => consumeBelt(s, index)));
    setBeltBusy(null);
  };

  const pressBeltSlot = (index: number) => {
    const item = game.belt[index];
    const action = item ? beltAction(item) : null;
    if (!action) return setActionError(language === 'en' ? 'This item cannot be used in battle' : 'Этот предмет нельзя использовать в бою');
    if (!isActive || !alive) return setActionError(language === 'en' ? 'The belt works only during battle while you are alive' : 'Пояс работает только во время боя, пока ты в строю');
    hapticImpact('light');
    if (action.kind === 'time') return runBelt(index, () => applyTimePotion(roomId));
    if (action.kind === 'item') return runBelt(index, () => drinkArenaItem(roomId, action.code));
    if (room?.mode === 'duel') return setActionError(language === 'en' ? 'Adrenaline works only in team battles' : 'Адреналин работает только в командных боях');
    setActionError(null);
    setAlliesOpen(true);
  };

  const revive = (id: string) => {
    if (adrenalineSlot < 0) return;
    runBelt(adrenalineSlot, () => reviveAlly(roomId, id));
  };

  const leave = () => run(() => leaveArena(roomId), onExit);

  if (!view || !room || !me) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-teal-400" />
        <p className="text-sm">{offline ? (language === 'en' ? 'Arena connection lost, reconnecting...' : 'Нет связи с ареной, переподключаюсь...') : (language === 'en' ? 'Entering arena...' : 'Вход на арену...')}</p>
      </div>
    );
  }

  const canRevive = isActive && alive && adrenalineSlot >= 0 && view.me.revivesUsed < 3;
  const movedCount = view.participants.filter((p) => p.hp > 0 && p.moved).length;
  const aliveCount = view.participants.filter((p) => p.hp > 0).length;
  const won = room.winnerTeam !== null && room.winnerTeam === me.team;
  const draw = room.status === 'finished' && room.winnerTeam === null;
  const isDuel = room.mode === 'duel';
  const resultPanel = room.status === 'finished' ? createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-[3px]">
      <div className={`relative w-full max-w-[300px] overflow-hidden rounded-[22px] border-2 bg-gradient-to-b from-[#071526] via-[#040d19] to-[#020711] p-3 shadow-2xl ${won || draw ? 'border-amber-400/80 shadow-amber-500/20' : 'border-amber-400/60 shadow-red-500/20'}`}>
        {won && <VictorySparks />}
        <div className={`pointer-events-none absolute inset-x-7 top-0 h-px ${won || draw ? 'bg-cyan-300 shadow-[0_0_12px_3px_rgba(34,211,238,0.45)]' : 'bg-red-400 shadow-[0_0_12px_3px_rgba(248,113,113,0.45)]'}`} />
        <div className="pointer-events-none absolute -top-12 left-1/2 h-20 w-36 -translate-x-1/2 rounded-full bg-cyan-500/10 blur-2xl" />
        <div className="relative mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-amber-300/80 bg-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.22)]">
          {won ? <Trophy className="h-6 w-6 text-amber-300" strokeWidth={2.2} /> : <Swords className={`h-6 w-6 ${draw ? 'text-amber-300' : 'text-red-300'}`} strokeWidth={2.2} />}
        </div>
        <div className="mt-1 flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-[0.28em] text-sky-300/80">
          <span className="h-px w-7 bg-gradient-to-r from-transparent to-amber-400/80" />
          {language === 'en' ? 'ARENA' : 'АРЕНА'}
          <span className="h-px w-7 bg-gradient-to-l from-transparent to-amber-400/80" />
        </div>
        <h2 className={`mt-1 text-center text-xl font-black tracking-wide drop-shadow-[0_0_12px_rgba(0,0,0,0.8)] ${won ? 'text-amber-300' : draw ? 'text-amber-300' : 'text-red-400'}`}>
          {won ? (language === 'en' ? 'VICTORY!' : 'ПОБЕДА!') : draw ? (language === 'en' ? 'DRAW' : 'НИЧЬЯ') : (language === 'en' ? 'DEFEAT!' : 'ПОРАЖЕНИЕ!')}
        </h2>
        <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-sky-800/70 bg-slate-950/90 shadow-inner shadow-black/50">
          <div className="flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2.5">
            <Coins className="h-6 w-6 text-amber-300 drop-shadow-[0_0_7px_rgba(251,191,36,0.3)]" />
            <span className="text-[10px] text-sky-100/90">{language === 'en' ? 'Gold' : 'Монеты'}</span>
            <span className="text-sm font-black tabular-nums text-amber-300">{reward ? `+${reward.gold}` : '—'}</span>
          </div>
          <div className="flex min-w-0 flex-col items-center justify-center gap-1 border-x border-sky-900/70 px-1 py-2.5">
            <Sparkles className="h-6 w-6 text-emerald-300 drop-shadow-[0_0_7px_rgba(52,211,153,0.28)]" />
            <span className="text-[10px] text-sky-100/90">{language === 'en' ? 'XP' : 'Опыт'}</span>
            <span className="text-sm font-black tabular-nums text-emerald-300">{reward ? `+${reward.xp}` : '—'}</span>
          </div>
          <div className="flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2.5">
            <Trophy className={`h-6 w-6 ${(reward?.ratingChange ?? view.me.ratingChange ?? 0) >= 0 ? 'text-sky-300' : 'text-red-400'}`} />
            <span className="text-[10px] text-sky-100/90">{language === 'en' ? 'Rating' : 'Рейтинг'}</span>
            <span className={`text-sm font-black tabular-nums ${(reward?.ratingChange ?? view.me.ratingChange ?? 0) >= 0 ? 'text-sky-300' : 'text-red-400'}`}>
              {reward ? `${reward.ratingChange > 0 ? '+' : ''}${reward.ratingChange}` : view.me.ratingChange !== null ? `${view.me.ratingChange > 0 ? '+' : ''}${view.me.ratingChange}` : '—'}
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-xl border border-sky-900/70 bg-slate-950/90 px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-slate-200"><Skull className="h-5 w-5 text-slate-300" />{language === 'en' ? 'Kills' : 'Убийства'}</span>
          <span className="text-sm font-black tabular-nums text-white">{reward ? reward.kills : '—'}</span>
        </div>
        <button disabled={busy} onClick={leave} className={`mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full border text-sm font-extrabold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50 ${won || draw ? 'border-sky-300 bg-gradient-to-b from-blue-500 to-blue-800 shadow-blue-950/70' : 'border-red-300/90 bg-gradient-to-b from-red-500 to-red-900 shadow-red-950/70'}`}>
          <LogOut className="h-4 w-4" />{language === 'en' ? 'Leave arena' : 'Покинуть арену'}
        </button>
        <div className={`pointer-events-none absolute inset-x-8 bottom-0 h-px ${won || draw ? 'bg-cyan-300/90' : 'bg-red-400/90'}`} />
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="space-y-2 animate-fade-in pb-4">
      <div className="flex items-center gap-2 h-9 px-2.5 rounded-xl border border-white/10 bg-gray-900/70">
        <p className="flex-1 min-w-0 text-[11px] truncate">
          <span className="text-gray-500 uppercase tracking-wide">{modeLabel[room.mode]}</span>
          <span className="text-white font-semibold"> · {room.status === 'waiting' ? (language === 'en' ? 'Waiting for fighters' : 'Сбор бойцов') : room.status === 'active' ? (language === 'en' ? `Round ${room.round}` : `Раунд ${room.round}`) : (language === 'en' ? 'Battle ended' : 'Бой окончен')}</span>
          {me.team && !isDuel && <span className="text-teal-300"> · «{teamLabel(me.team)}»</span>}
        </p>
        {offline && <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />}
        {room.status !== 'finished' && (
          <div
            title={isActive ? (language === 'en' ? `Turn timer: ${room.timeout} sec.` : `Тайм на ход: ${room.timeout} сек.`) : undefined}
            className={`flex items-center gap-1 h-6 px-2 rounded-lg text-xs font-bold tabular-nums shrink-0 ${
              isActive && countdown <= 10 ? 'bg-red-500/20 text-red-300 animate-pulse' : 'bg-black/40 text-white'
            }`}
          >
            <Timer className="w-3 h-3" /> {countdown}{language === 'en' ? 's' : 'с'}
            {isActive && <span className="text-[9px] font-normal text-gray-500">/{room.timeout}</span>}
          </div>
        )}
      </div>

      {room.status === 'waiting' && (
        <div className="card text-center py-6">
          <Loader2 className="w-8 h-8 animate-spin text-amber-400 mx-auto mb-3" />
          <p className="text-white font-semibold">{language === 'en' ? 'Searching for opponents...' : 'Ищем соперников...'}</p>
          <p className="text-sm text-gray-400 mt-1">{language === 'en' ? `Battle starts in ${countdown} sec.` : `Бой начнётся через ${countdown} сек.`}</p>
          <p className="text-xs text-gray-500 mt-3">{language === 'en' ? 'Arena:' : 'На арене:'} {view.participants.map((p) => p.name).join(', ')}</p>
          <button disabled={busy} onClick={leave} className="btn-ghost text-sm mt-4">{language === 'en' ? 'Cancel search' : 'Отменить поиск'}</button>
        </div>
      )}

      {room.status !== 'waiting' && (
        <BattleScene
          me={me}
          enemy={shownEnemy}
          active={isActive}
          moved={view.me.moved}
          auto={view.me.auto}
          autoLocked={view.me.vip < view.me.autoMinVip}
          autoMinVip={view.me.autoMinVip}
          attack={attack}
          blocks={blocks}
          busy={busy}
          movedCount={movedCount}
          aliveCount={aliveCount}
          strike={strikeEvent}
          canRepeat={!!lastMove}
          onAttack={setAttack}
          onToggleBlock={toggleBlock}
          onStrike={strike}
          onRepeat={repeatMove}
          onToggleAuto={toggleAuto}
          resultPanel={resultPanel}
        />
      )}

      <ArenaChat roomId={roomId} messages={messages} myName={me.name} />

      {room.status !== 'waiting' && (
        <div className="space-y-1.5">
          <FoldSection
            title={language === 'en' ? 'Elixirs and items' : 'Эликсиры и предметы'}
            open={beltOpen}
            onToggle={() => setBeltOpen((o) => !o)}
            summary={
              <>
                {game.belt.map((s, i) => s && i < 3 && (
                  <ItemArt key={i} item={s} size={20} />
                ))}
                <span className="text-[10px] text-gray-500 tabular-nums ml-1">{game.belt.filter(Boolean).length}/7</span>
              </>
            }
          >
            <BeltBar
              belt={game.belt}
              ctx={beltContext(game, arenaStats.wins)}
              actionLabel={isActive && alive ? (language === 'en' ? 'Tap a potion to drink (one per round)' : 'Нажми на зелье, чтобы выпить (одно за раунд)') : (language === 'en' ? 'Manage your potion belt in inventory' : 'Пояс с зельями — собирается в сумке')}
              disabled={!isActive || !alive || busy}
              busyIndex={beltBusy}
              onAction={pressBeltSlot}
            />
          </FoldSection>
          <FoldSection
            title={language === 'en' ? 'Equipment' : 'Снаряжение'}
            open={gearOpen}
            onToggle={() => setGearOpen((o) => !o)}
            summary={
              <>
                {Object.values(game.player.equipped).filter((eq) => !!eq).slice(0, 3).map((eq) => (
                  <img key={eq!.id} src={equipmentArt(eq!)} alt="" className="h-5 w-5 object-contain" />
                ))}
                <span className="text-[10px] text-gray-500 tabular-nums ml-1">{Object.values(game.player.equipped).filter(Boolean).length}/7</span>
              </>
            }
          >
            <GearStrip equipped={game.player.equipped} />
          </FoldSection>
        </div>
      )}

      {actionError && <div className="card text-center text-sm text-red-400 py-3 animate-fade-in">{actionError}</div>}

      {isActive && !alive && !isDuel && (
        <div className="card text-center py-3 border-red-500/30">
          <p className="text-xs text-gray-400">{language === 'en' ? 'An ally can revive you with adrenaline. Follow the battle in chat.' : 'Союзник может вернуть тебя адреналином. Следи за боем в чате.'}</p>
        </div>
      )}

      {room.status !== 'waiting' && !isDuel && (
        <div className="space-y-1.5">
          <FighterList
            title={`${language === 'en' ? 'Enemies' : 'Противники'} · ${teamLabel(me.team === 1 ? 2 : 1)}`}
            accent="enemy"
            fighters={enemies}
            meId={me.id}
            active={isActive}
            selectedId={isActive && alive ? shownEnemy?.id : null}
            onSelect={isActive && alive && !view.me.moved && !view.me.auto ? setTargetId : undefined}
            open={enemiesOpen}
            onToggle={() => setEnemiesOpen((o) => !o)}
          />
          <FighterList
            title={`${language === 'en' ? 'Your team' : 'Твоя команда'} · ${teamLabel(me.team ?? 1)}`}
            accent="ally"
            fighters={allies}
            meId={me.id}
            active={isActive}
            onRevive={canRevive ? revive : undefined}
            open={alliesOpen}
            onToggle={() => setAlliesOpen((o) => !o)}
          />
        </div>
      )}

      {isActive && (
        <button onClick={() => setConfirmLeave(true)} className="btn-ghost w-full text-xs text-gray-500">{language === 'en' ? 'Leave battle' : 'Покинуть бой'}</button>
      )}

      {confirmLeave && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setConfirmLeave(false)}>
          <div className="card w-full max-w-sm text-center animate-pop" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">{language === 'en' ? 'Leave battle?' : 'Покинуть бой?'}</h3>
            <p className="text-sm text-gray-400 mb-4">{alive ? (language === 'en' ? 'You will count as defeated, and your team may lose.' : 'Ты будешь считаться павшим, и бой может быть проигран.') : (language === 'en' ? 'You will no longer see this battle chat.' : 'Ты больше не увидишь чат этого боя.')}</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setConfirmLeave(false)}>{language === 'en' ? 'Stay' : 'Остаться'}</button>
              <button className="btn-danger" disabled={busy} onClick={() => { setConfirmLeave(false); leave(); }}>{language === 'en' ? 'Leave' : 'Выйти'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
