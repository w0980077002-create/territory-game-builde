import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/game/store';
import { useGame, useArena } from '@/game/actions';
import { secureArenaClaim, secureArenaItem } from '@/game/arenaSecure';
import {
  TEAM_NAMES, leaveArena, submitArenaMove,
  setArenaAuto, arenaPostFightDeadline, type ArenaReward, type Zone,
} from '@/game/arenaApi';
import { useArenaRoom, useCountdown } from '@/game/useArenaRoom';
import { useStrikeQueue } from '@/game/useStrikeQueue';
import { beltAction, beltContext } from '@/game/belt';
import { hapticImpact, hapticNotify } from '@/game/telegram';
import { FighterList } from './FighterList';
import { BattleScene } from './BattleScene';
import { ArenaResultCard } from './ArenaResultCard';
import { ArenaChat } from './ArenaChat';
import { GearStrip } from './GearStrip';
import { BeltBar } from './BeltBar';
import { FoldSection } from './FoldSection';
import { equipmentArt } from '@/game/art';
import { ItemArt } from '@/components/ui/ItemArt';
import { IosGamePortal } from '@/components/ui/Modal';
import { ChevronDown, Loader2, Timer, WifiOff } from 'lucide-react';
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
  const [beltOpen, setBeltOpen] = useState(true);
  const [enemiesOpen, setEnemiesOpen] = useState(false);
  const [alliesOpen, setAlliesOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const claiming = useRef(false);
  const prevHp = useRef<number | null>(null);
  const autoLeaving = useRef(false);
  const [postFightDeadline, setPostFightDeadline] = useState<number | null>(null);

  const room = view?.room;
  const countdown = useCountdown(room ? (room.status === 'waiting' ? room.startsAt : room.deadline) : null, clockOffset);
  const finished = room?.status === 'finished';
  const chatSeconds = useCountdown(finished ? postFightDeadline : null, clockOffset);
  const chatExpired = finished && postFightDeadline !== null && chatSeconds === 0;

  // Elixirs stay open during combat. Once the duel ends, collapse them
  // automatically to reveal more chat; the arrow can reopen at any time.
  useEffect(() => {
    if (finished) setBeltOpen(false);
    else if (room?.status === 'active') setBeltOpen(true);
  }, [finished, room?.status]);

  useEffect(() => {
    if (!finished) return;
    let cancelled = false;
    arenaPostFightDeadline(roomId)
      .then((deadline) => {
        if (!cancelled && typeof deadline === 'number' && Number.isFinite(deadline) && deadline > 0) {
          setPostFightDeadline(deadline);
        }
      })
      .catch(() => {
        // A missing network response must never invent or reset a 30-minute timer.
      });
    return () => { cancelled = true; };
  }, [roomId, finished]);
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
    secureArenaClaim(roomId)
      .then(({ reward: r, alreadyClaimed }) => {
        if (alreadyClaimed) return;
        if (!r) { claiming.current = false; return; }
        // No local gold/XP award. Server transaction already credited the saved profile.
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
    // The RPC validates/debits this precise belt slot with the combat action.
    await run(fn);
    setBeltBusy(null);
  };

  const pressBeltSlot = (index: number) => {
    const item = game.belt[index];
    const action = item ? beltAction(item) : null;
    if (!action) return setActionError(language === 'en' ? 'This item cannot be used in battle' : 'Этот предмет нельзя использовать в бою');
    if (!isActive || !alive) return setActionError(language === 'en' ? 'The belt works only during battle while you are alive' : 'Пояс работает только во время боя, пока ты в строю');
    hapticImpact('light');
    if (action.kind === 'time') return runBelt(index, () => secureArenaItem(roomId, index, 'time'));
    if (action.kind === 'item') return runBelt(index, () => secureArenaItem(roomId, index, action.code));
    if (room?.mode === 'duel') return setActionError(language === 'en' ? 'Adrenaline works only in team battles' : 'Адреналин работает только в командных боях');
    setActionError(null);
    setAlliesOpen(true);
  };

  const revive = (id: string) => {
    if (adrenalineSlot < 0) return;
    runBelt(adrenalineSlot, () => secureArenaItem(roomId, adrenalineSlot, 'adrenaline', id));
  };

  const leave = () => run(() => leaveArena(roomId), onExit);

  useEffect(() => {
    // Claim the result before auto-exiting: a player away during the chat window
    // must not silently forfeit gold or experience upon reconnecting.
    if (!chatExpired || autoLeaving.current || (!view?.me.rewarded && !reward) || busy) return;
    autoLeaving.current = true;
    leaveArena(roomId)
      .then(onExit)
      .catch(() => {
        autoLeaving.current = false;
        setActionError(language === 'en'
          ? 'Could not leave the arena. Please tap Leave arena.'
          : 'Не удалось выйти автоматически. Нажми «Покинуть арену».');
      });
  }, [chatExpired, view?.me.rewarded, reward, busy, roomId, onExit, language]);

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
          finished={finished}
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
          resultPanel={finished ? (
            <ArenaResultCard
              won={won}
              draw={draw}
              reward={reward}
              alreadyRewarded={view.me.rewarded}
              ratingChange={view.me.ratingChange}
              deadlineReady={postFightDeadline !== null}
              remainingSeconds={chatSeconds}
              busy={busy || autoLeaving.current}
              onLeave={leave}
            />
          ) : undefined}
        />
      )}

      {/* A slim, collapsible quick belt immediately between the fight and chat.
          Its state is independent of equipment and item usage restrictions. */}
      {room.status !== 'waiting' && (
        <section aria-label={language === 'en' ? 'Battle elixirs' : 'Боевые эликсиры'}
          className="overflow-hidden rounded-xl border border-amber-400/35 bg-gradient-to-b from-[#241a19]/95 to-[#080e1c]/95 shadow-[0_3px_10px_rgba(0,0,0,0.4)]">
          <button
            type="button"
            aria-expanded={beltOpen}
            aria-controls="arena-quick-belt"
            onClick={() => setBeltOpen((open) => !open)}
            className="flex h-7 w-full items-center gap-2 px-2 text-left transition-colors hover:bg-white/5"
          >
            <span className="shrink-0 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-amber-200">
              {language === 'en' ? 'Elixirs & items' : 'Эликсиры и предметы'}
            </span>
            <span className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
              {!beltOpen && game.belt.map((item, index) =>
                item && index < 3 ? <ItemArt key={index} item={item} size={19} /> : null
              )}
              <span className="shrink-0 text-[10px] font-semibold tabular-nums text-amber-100/75">
                {game.belt.filter(Boolean).length}/7
              </span>
            </span>
            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-amber-200 transition-transform duration-200 ${beltOpen ? 'rotate-180' : ''}`} />
          </button>
          {beltOpen && (
            <div id="arena-quick-belt" className="px-1.5 pb-1 pt-0.5">
              <BeltBar
                compact
                belt={game.belt}
                ctx={beltContext(game, arenaStats.wins)}
                actionLabel={isActive && alive ? (language === 'en' ? 'Tap to use · one potion per round' : 'Нажми для использования · одно зелье за раунд') : (language === 'en' ? 'Equip potions from inventory' : 'Пополняй зелья в инвентаре')}
                disabled={!isActive || !alive || busy}
                busyIndex={beltBusy}
                onAction={pressBeltSlot}
              />
            </div>
          )}
        </section>
      )}

      <ArenaChat
        roomId={roomId}
        messages={messages}
        myName={me.name}
        canSend={!chatExpired}
      />

      {room.status !== 'waiting' && (
        <div className="space-y-1.5">
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
        <IosGamePortal>
        <div className="arena-modal-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setConfirmLeave(false)}>
          <div className="card w-full max-w-sm text-center animate-pop" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">{language === 'en' ? 'Leave battle?' : 'Покинуть бой?'}</h3>
            <p className="text-sm text-gray-400 mb-4">{alive ? (language === 'en' ? 'You will count as defeated, and your team may lose.' : 'Ты будешь считаться павшим, и бой может быть проигран.') : (language === 'en' ? 'You will no longer see this battle chat.' : 'Ты больше не увидишь чат этого боя.')}</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setConfirmLeave(false)}>{language === 'en' ? 'Stay' : 'Остаться'}</button>
              <button className="btn-danger" disabled={busy} onClick={() => { setConfirmLeave(false); leave(); }}>{language === 'en' ? 'Leave' : 'Выйти'}</button>
            </div>
          </div>
        </div>
        </IosGamePortal>
      )}
    </div>
  );
}
