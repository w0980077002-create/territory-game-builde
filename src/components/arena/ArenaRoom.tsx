import { useEffect, useRef, useState } from 'react';
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
import { ArenaChat } from './ArenaChat';
import { GearStrip } from './GearStrip';
import { BeltBar } from './BeltBar';
import { FoldSection } from './FoldSection';
import { Loader2, LogOut, Timer, WifiOff, Skull, Trophy } from 'lucide-react';

const MODE_LABEL = { duel: 'Дуэль 1х1', team: 'Отряд 3х3', chaos: 'Хаос' } as const;

export function ArenaRoom({ roomId, onExit }: { roomId: string; onExit: () => void }) {
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
  const [beltOpen, setBeltOpen] = useState(true);
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
      setActionError((e as Error).message);
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
    if (!action) return setActionError('Этот предмет нельзя использовать в бою');
    if (!isActive || !alive) return setActionError('Пояс работает только во время боя, пока ты в строю');
    hapticImpact('light');
    if (action.kind === 'time') return runBelt(index, () => applyTimePotion(roomId));
    if (action.kind === 'item') return runBelt(index, () => drinkArenaItem(roomId, action.code));
    if (room?.mode === 'duel') return setActionError('Адреналин работает только в командных боях');
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
        <p className="text-sm">{offline ? 'Нет связи с ареной, переподключаюсь...' : 'Вход на арену...'}</p>
      </div>
    );
  }

  const canRevive = isActive && alive && adrenalineSlot >= 0 && view.me.revivesUsed < 3;
  const movedCount = view.participants.filter((p) => p.hp > 0 && p.moved).length;
  const aliveCount = view.participants.filter((p) => p.hp > 0).length;
  const won = room.winnerTeam !== null && room.winnerTeam === me.team;
  const draw = room.status === 'finished' && room.winnerTeam === null;
  const isDuel = room.mode === 'duel';
  const followerName = game.followers[0]?.name ?? 'Последователь';

  return (
    <div className="space-y-2 animate-fade-in pb-4">
      <div className="flex items-center gap-2 h-9 px-2.5 rounded-xl border border-white/10 bg-gray-900/70">
        <p className="flex-1 min-w-0 text-[11px] truncate">
          <span className="text-gray-500 uppercase tracking-wide">{MODE_LABEL[room.mode]}</span>
          <span className="text-white font-semibold"> · {room.status === 'waiting' ? 'Сбор бойцов' : room.status === 'active' ? `Раунд ${room.round}` : 'Бой окончен'}</span>
          {me.team && !isDuel && <span className="text-teal-300"> · «{TEAM_NAMES[me.team]}»</span>}
        </p>
        {offline && <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />}
        {room.status !== 'finished' && (
          <div
            title={isActive ? `Тайм на ход: ${room.timeout} сек.` : undefined}
            className={`flex items-center gap-1 h-6 px-2 rounded-lg text-xs font-bold tabular-nums shrink-0 ${
              isActive && countdown <= 10 ? 'bg-red-500/20 text-red-300 animate-pulse' : 'bg-black/40 text-white'
            }`}
          >
            <Timer className="w-3 h-3" /> {countdown}с
            {isActive && <span className="text-[9px] font-normal text-gray-500">/{room.timeout}</span>}
          </div>
        )}
      </div>

      {room.status === 'waiting' && (
        <div className="card text-center py-6">
          <Loader2 className="w-8 h-8 animate-spin text-amber-400 mx-auto mb-3" />
          <p className="text-white font-semibold">Ищем соперников...</p>
          <p className="text-sm text-gray-400 mt-1">Бой начнётся через {countdown} сек.</p>
          <p className="text-xs text-gray-500 mt-3">На арене: {view.participants.map((p) => p.name).join(', ')}</p>
          <button disabled={busy} onClick={leave} className="btn-ghost text-sm mt-4">Отменить поиск</button>
        </div>
      )}

      {room.status === 'finished' && (
        <div className={`card text-center py-5 animate-pop relative overflow-hidden ${won ? 'border-emerald-500/40' : draw ? 'border-amber-500/40' : 'border-red-500/40'}`}>
          <div className={`absolute inset-0 pointer-events-none bg-gradient-to-b ${won ? 'from-emerald-500/15' : draw ? 'from-amber-500/15' : 'from-red-500/15'} to-transparent`} />
          <div className="relative">
            {won ? <Trophy className="w-12 h-12 text-amber-400 mx-auto mb-2" /> : <Skull className="w-12 h-12 text-gray-400 mx-auto mb-2" />}
            <h2 className={`text-2xl font-bold ${won ? 'text-emerald-400' : draw ? 'text-amber-400' : 'text-red-400'}`}>
              {won ? 'Победа!' : draw ? 'Ничья' : 'Поражение'}
            </h2>
            {reward ? (
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm mt-3">
                <span className="text-amber-400">+{reward.gold} золота</span>
                <span className="text-teal-400">+{reward.xp} опыта</span>
                <span className={reward.ratingChange >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {reward.ratingChange >= 0 ? '+' : ''}{reward.ratingChange} рейтинга
                </span>
                {reward.kills > 0 && <span className="text-gray-300">убийств: {reward.kills}</span>}
              </div>
            ) : (
              view.me.ratingChange !== null && (
                <p className="text-sm text-gray-400 mt-2">Рейтинг: {view.me.ratingChange >= 0 ? '+' : ''}{view.me.ratingChange}</p>
              )
            )}
            <p className="text-xs text-gray-500 mt-3">Чат открыт, пока ты в комнате</p>
            <button disabled={busy} onClick={leave} className="btn-primary mt-3 inline-flex items-center gap-2">
              <LogOut className="w-4 h-4" /> Покинуть комнату
            </button>
          </div>
        </div>
      )}

      {room.status !== 'waiting' && (
        <BattleScene
          me={me}
          enemy={shownEnemy}
          followerName={followerName}
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
        />
      )}

      {room.status !== 'waiting' && (
        <div className="space-y-1.5">
          <FoldSection
            title="Снаряжение"
            open={gearOpen}
            onToggle={() => setGearOpen((o) => !o)}
            summary={
              <>
                {Object.values(game.player.equipped).filter(Boolean).slice(0, 7).map((eq) => (
                  <span key={eq!.id} className="text-sm leading-none">{eq!.icon}</span>
                ))}
                <span className="text-[10px] text-gray-500 tabular-nums ml-1">{Object.values(game.player.equipped).filter(Boolean).length}/7</span>
              </>
            }
          >
            <GearStrip equipped={game.player.equipped} />
          </FoldSection>
          <FoldSection
            title="Эликсиры и предметы"
            open={beltOpen}
            onToggle={() => setBeltOpen((o) => !o)}
            summary={
              <>
                {game.belt.map((s, i) => s && (
                  <span key={i} className="text-sm leading-none">{s.icon}<span className="text-[9px] text-gray-400">{s.qty}</span></span>
                ))}
              </>
            }
          >
            <BeltBar
              belt={game.belt}
              ctx={beltContext(game, arenaStats.wins)}
              actionLabel={isActive && alive ? 'Нажми на зелье, чтобы выпить (одно за раунд)' : 'Пояс с зельями — собирается в сумке'}
              disabled={!isActive || !alive || busy}
              busyIndex={beltBusy}
              onAction={pressBeltSlot}
            />
          </FoldSection>
        </div>
      )}

      {actionError && <div className="card text-center text-sm text-red-400 py-3 animate-fade-in">{actionError}</div>}

      {isActive && !alive && !isDuel && (
        <div className="card text-center py-3 border-red-500/30">
          <p className="text-xs text-gray-400">Союзник может вернуть тебя адреналином. Следи за боем в чате.</p>
        </div>
      )}

      {room.status !== 'waiting' && !isDuel && (
        <div className="space-y-1.5">
          <FighterList
            title={`Противники · ${TEAM_NAMES[me.team === 1 ? 2 : 1]}`}
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
            title={`Твоя команда · ${TEAM_NAMES[me.team ?? 1]}`}
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

      <ArenaChat roomId={roomId} messages={messages} myName={me.name} />

      {isActive && (
        <button onClick={() => setConfirmLeave(true)} className="btn-ghost w-full text-xs text-gray-500">Покинуть бой</button>
      )}

      {confirmLeave && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setConfirmLeave(false)}>
          <div className="card w-full max-w-sm text-center animate-pop" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Покинуть бой?</h3>
            <p className="text-sm text-gray-400 mb-4">{alive ? 'Ты будешь считаться павшим, и бой может быть проигран.' : 'Ты больше не увидишь чат этого боя.'}</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setConfirmLeave(false)}>Остаться</button>
              <button className="btn-danger" disabled={busy} onClick={() => { setConfirmLeave(false); leave(); }}>Выйти</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
