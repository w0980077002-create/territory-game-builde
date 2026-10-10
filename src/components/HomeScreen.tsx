import { useState, type ReactNode } from 'react';
import { ChevronRight, Repeat, Swords } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame, useArena, useAccount } from '@/game/actions';
import { generateChapter, getComputedStats } from '@/game/engine';
import { beltContext } from '@/game/belt';
import { getAppearanceIcon } from '@/game/appearance';
import { MAIL, blessingReady, claimBlessing, dailyStatus } from '@/game/progression';
import type { AuthUser } from '@/game/auth';
import { useLive } from '@/game/live';
import type { BattleView } from '@/components/BattleScreen';
import { EquipCells } from '@/components/ui/EquipCells';
import { BeltCells } from '@/components/ui/BeltCells';
import { Currency, formatAmount } from '@/components/ui/Currency';
import { DailySheet, MailSheet, SettingsSheet, StonesSheet, type SaveStatus } from '@/components/home/HomeSheets';

export type HomeTarget = 'shop' | 'forge' | 'arena' | 'quests' | 'hero' | 'leaderboard' | 'professions';

interface Props {
  user: AuthUser;
  saveStatus: SaveStatus;
  onOpen: (to: HomeTarget) => void;
  onBattle: (view: BattleView, autoStart?: boolean) => void;
  onInventory: (tab: 'items' | 'equipment') => void;
  notify: (text: string) => void;
}

type Sheet = 'daily' | 'mail' | 'settings' | 'stones' | null;

function SideButton({ icon, label, onClick, soon, badge }: { icon: string; label: string; onClick: () => void; soon?: boolean; badge?: boolean }) {
  return (
    <button onClick={onClick} className="home-side group" aria-label={label}>
      <img src={icon} alt="" draggable={false} className={`w-[78%] max-h-[62%] object-contain drop-shadow-[0_3px_4px_rgba(0,0,0,0.7)] transition-transform group-hover:scale-110 ${soon ? 'opacity-70 grayscale-[35%]' : ''}`} />
      <span className="text-[7.5px] leading-[1.05] font-bold text-amber-50 text-center truncate max-w-full px-px [text-shadow:0_1px_2px_#000]">{label}</span>
      {soon && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-slate-400 border border-black" aria-hidden />}
      {badge && <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border border-black animate-pulse" />}
    </button>
  );
}

function HudIcon({ icon, label, onClick, badge }: { icon: string; label: string; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} aria-label={label} className="relative w-8 h-8 rounded-lg border border-amber-400/30 bg-black/55 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform">
      <img src={icon} alt="" className="w-6 h-6 object-contain" />
      {!!badge && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">{badge}</span>}
    </button>
  );
}

function Orb({ tone, value, label }: { tone: 'hp' | 'energy'; value: string; label: string }) {
  const fill = tone === 'hp' ? 'from-red-400 via-red-600 to-red-950' : 'from-sky-300 via-blue-600 to-blue-950';
  return (
    <div className="relative w-[52px] h-[52px] shrink-0 rounded-full p-[3px] bg-gradient-to-b from-amber-300 via-amber-700 to-amber-950 shadow-[0_3px_8px_rgba(0,0,0,0.6)]">
      <div className={`w-full h-full rounded-full bg-gradient-to-b ${fill} flex flex-col items-center justify-center overflow-hidden relative`}>
        <span className="absolute top-1 left-2 w-4 h-2 rounded-full bg-white/35 blur-[1px]" />
        <span className="text-[10px] font-bold text-white tabular-nums leading-none [text-shadow:0_1px_2px_#000]">{value}</span>
        <span className="text-[8px] font-semibold text-white/80 leading-tight">{label}</span>
      </div>
    </div>
  );
}

function ControlButton({ active, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`relative w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center font-bold text-sm transition-all active:scale-90 ${
        active ? 'border-amber-300 bg-gradient-to-b from-amber-500/50 to-amber-800/60 text-white shadow-[0_0_10px_rgba(251,191,36,0.35)]' : 'border-amber-400/25 bg-black/60 text-amber-100/80'
      }`}
    >
      {children}
    </button>
  );
}

export function HomeScreen({ user, saveStatus, onOpen, onBattle, onInventory, notify }: Props) {
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const { vip } = useStore(useAccount);
  const [sheet, setSheet] = useState<Sheet>(null);

  const { player } = state;
  const chapter = generateChapter(state.currentChapter);
  const wins = Math.min(state.chapterWins, chapter.winsNeeded);
  const bossReady = wins >= chapter.winsNeeded;
  const nextEnemy = bossReady ? chapter.boss : chapter.enemies[wins];
  const stats = getComputedStats(state);
  const follower = state.followers.find((f) => f.unlocked);
  const xpPct = Math.min(100, (player.xp / player.xpToNext) * 100);
  const adminMail = useStore(useLive).mail.length;
  const unreadMail = MAIL.filter((l) => !state.mailClaimed.includes(l.id)).length + adminMail;
  const blessReady = blessingReady(state);
  const quest = state.quests.find((q) => !q.claimed && q.current < q.target) ?? state.quests.find((q) => !q.claimed);

  const soon = (label: string) => notify(`${label} откроется в следующих обновлениях`);

  const setSettings = (patch: Partial<typeof state.settings>) => useGame.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  const bless = () => {
    const next = claimBlessing(useGame.get());
    if (next) {
      useGame.set(next);
      notify(`Благословение: +50% золота в ${next.blessing.charges} боях похода`);
    } else {
      notify(state.blessing.charges > 0 ? `Благословение активно: осталось ${state.blessing.charges}` : 'Благословение уже получено сегодня');
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden select-none animate-fade-in">
      <img src="/city-bg.webp" alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-[260px] bg-gradient-to-t from-[#07090d] via-[#07090d]/85 to-transparent pointer-events-none" />

      <div className="absolute inset-x-0 top-0 z-20 px-2 pt-[max(8px,env(safe-area-inset-top))] flex items-start gap-2">
        <button onClick={() => onOpen('hero')} className="flex items-center gap-1.5 min-w-0 shrink-0 rounded-2xl border border-amber-400/30 bg-black/55 backdrop-blur-sm p-1 pr-2 active:scale-95 transition-transform" aria-label="Профиль героя">
          <span className="relative w-11 h-11 rounded-xl overflow-hidden border-2 border-amber-400/70 bg-[#1b1a16] shrink-0">
            <img src={getAppearanceIcon(state.appearance)} alt="" className="w-full h-full object-contain object-top" />
          </span>
          <span className="flex flex-col items-start min-w-0 w-[64px]">
            <span className="text-[12px] font-bold text-white truncate w-full text-left leading-tight">{player.name}</span>
            <span className="flex items-center gap-1 text-[10px] leading-tight">
              <span className="text-amber-200 font-semibold">Ур. {player.level}</span>
              <span className="px-1 rounded bg-gradient-to-r from-amber-400 to-amber-600 text-black font-bold text-[9px]">VIP {vip}</span>
            </span>
            <span className="mt-1 h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <span className="block h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${xpPct}%` }} />
            </span>
          </span>
        </button>

        <div className="flex-1 min-w-0 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1 w-full justify-end">
            <span className="hud-chip min-w-0"><Currency kind="gold" value={formatAmount(player.gold)} size={20} className="text-[11px] text-white" /></span>
            <span className="hud-chip min-w-0"><Currency kind="gems" value={formatAmount(player.gems)} size={20} className="text-[11px] text-white" /></span>
            <span className="hud-chip min-w-0"><Currency kind="redGems" value={formatAmount(player.redGems)} size={20} className="text-[11px] text-white" /></span>
          </div>
          <div className="flex items-center gap-1.5">
            <HudIcon icon="/ic-trophy.webp" label="Топ игроков" onClick={() => onOpen('leaderboard')} />
            <HudIcon icon="/ic-mail.webp" label="Почта" badge={unreadMail} onClick={() => setSheet('mail')} />
            <HudIcon icon="/ic-settings.webp" label="Настройки" onClick={() => setSheet('settings')} />
          </div>
        </div>
      </div>

      <button
        onClick={() => onBattle('campaign')}
        className="absolute z-10 left-1/2 -translate-x-1/2 top-[calc(max(8px,env(safe-area-inset-top))+92px)] max-w-[calc(100%-112px)] h-5 flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-gradient-to-b from-[#5a3a1c]/90 to-[#2a1a0c]/90 pl-2 pr-1 shadow-[0_2px_6px_rgba(0,0,0,0.6)] active:scale-95 transition-transform"
        aria-label="Открыть поход"
      >
        <span className="shrink-0 text-[9px] font-semibold text-amber-300 leading-none">Гл. {chapter.number}</span>
        <span className="min-w-0 truncate text-[10px] font-bold text-amber-50 leading-none">{chapter.title}</span>
        <span className="shrink-0 flex items-center gap-0.5">
          {chapter.enemies.map((e, i) => (
            <span key={e.id} className={`w-1.5 h-1.5 rounded-full border ${i < wins ? 'bg-amber-400 border-amber-200' : 'bg-black/60 border-amber-200/30'}`} />
          ))}
          <img src="/enemy-boss.webp" alt="Босс" className={`w-3.5 h-3.5 rounded-full object-cover object-top border ${bossReady ? 'border-red-400 animate-pulse' : 'border-white/20 grayscale opacity-70'}`} />
        </span>
      </button>

      <div className="absolute z-10 left-1.5 top-[calc(max(8px,env(safe-area-inset-top))+90px)] bottom-[200px] w-[44px] flex flex-col gap-1">
        <SideButton icon="/ic-events.webp" label="События" soon onClick={() => soon('События')} />
        <SideButton icon="/ic-daily.webp" label="Награды" badge={!dailyStatus(state).claimedToday} onClick={() => setSheet('daily')} />
        <SideButton icon="/ic-quests.webp" label="Задания" onClick={() => onOpen('quests')} />
        <SideButton icon="/ic-invite.webp" label="Друзья" soon onClick={() => soon('Приглашение друзей')} />
        <SideButton icon="/ic-sea.webp" label="Море" soon onClick={() => soon('Морской поход')} />
      </div>
      <div className="absolute z-10 right-1.5 top-[calc(max(8px,env(safe-area-inset-top))+90px)] bottom-[200px] w-[44px] flex flex-col gap-1">
        <SideButton icon="/ic-shop.webp" label="Лавка" onClick={() => onOpen('shop')} />
        <SideButton icon="/ic-forge.webp" label="Кузница" onClick={() => onOpen('forge')} />
        <SideButton icon="/ic-forge.webp" label="Профессии" onClick={() => onOpen('professions')} />
        <SideButton icon="/ic-trials.webp" label="Испытания" onClick={() => onBattle('trial')} />
        <SideButton icon="/ic-capture.webp" label="Захват" soon onClick={() => soon('Захват территорий')} />
        <SideButton icon="/ic-arena.webp" label="Арена" onClick={() => onOpen('arena')} />
      </div>

      <div className="absolute z-0 left-[48px] right-[48px] top-[calc(max(8px,env(safe-area-inset-top))+150px)] bottom-[196px] flex items-end justify-center pointer-events-none">
        <div className="relative h-[62%] w-[26%] flex items-end justify-center">
          {follower && (
            <img src="/follower-shield.webp" alt={follower.name} className="max-h-full max-w-full object-contain object-bottom drop-shadow-[0_6px_8px_rgba(0,0,0,0.7)] animate-idle" />
          )}
        </div>
        <div className="relative h-full w-[44%] flex items-end justify-center -ml-[6%]">
          <span className="absolute bottom-0 w-[80%] h-3 rounded-[50%] bg-black/50 blur-[3px]" />
          <img src={getAppearanceIcon(state.appearance)} alt={player.name} className="relative max-h-full max-w-full object-contain object-bottom drop-shadow-[0_8px_10px_rgba(0,0,0,0.7)] animate-idle" />
        </div>
        <button
          onClick={() => onBattle('campaign', true)}
          className="relative h-[70%] w-[34%] flex flex-col items-center justify-end pointer-events-auto group"
          aria-label={`В бой: ${nextEnemy.name}`}
        >
          <span className="mb-1 max-w-full rounded-md bg-black/70 border border-red-500/40 px-1.5 py-0.5 text-[9px] font-bold text-red-100 truncate">
            {nextEnemy.isBoss ? 'Босс: ' : ''}{nextEnemy.name}
          </span>
          <span className="absolute bottom-0 w-[80%] h-2.5 rounded-[50%] bg-black/50 blur-[3px]" />
          <img src={nextEnemy.art} alt="" className="relative min-h-0 flex-1 max-w-full object-contain object-bottom -scale-x-100 drop-shadow-[0_6px_8px_rgba(0,0,0,0.7)] transition-transform group-active:scale-95" />
          <span className="absolute bottom-1 right-0 flex items-center gap-0.5 rounded-full bg-red-600 border border-red-300 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-lg">
            <Swords className="w-3 h-3" /> В бой
          </span>
        </button>
      </div>

      <div className="absolute z-20 inset-x-0 bottom-0 px-2 pb-1.5 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 h-5 rounded-full border border-amber-400/30 bg-black/70 overflow-hidden">
            <span className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-lime-400 transition-[width] duration-500" style={{ width: `${xpPct}%` }} />
            <span className="absolute left-1.5 inset-y-0 flex items-center text-[9px] font-black text-amber-200 [text-shadow:0_1px_2px_#000]">EXP</span>
            <span className="relative flex h-full items-center justify-center text-[10px] font-bold text-white tabular-nums [text-shadow:0_1px_2px_#000]">
              {player.xp} / {player.xpToNext}
            </span>
          </div>
          <span className="h-5 px-2 rounded-full border border-amber-400/30 bg-black/70 text-[10px] font-bold text-amber-100 flex items-center">Ур. {player.level}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Orb tone="hp" value={formatAmount(stats.maxHp)} label="HP" />
          <div className="flex-1 min-w-0">
            <BeltCells belt={state.belt} ctx={beltContext(state, arena.wins)} onTap={() => onInventory('items')} />
          </div>
          <Orb tone="energy" value={`${player.energy}/${player.maxEnergy}`} label="Энергия" />
        </div>

        <EquipCells equipped={player.equipped} onTap={() => onInventory('equipment')} />

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onOpen('quests')}
            className="flex-1 min-w-0 h-10 flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-gradient-to-r from-[#3a2a16]/95 to-[#1a130a]/95 pl-1 pr-1.5 active:scale-[0.98] transition-transform"
          >
            <img src="/ic-quests.webp" alt="" className="w-8 h-8 object-contain shrink-0" />
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-[10px] font-semibold text-amber-50 truncate leading-tight">{quest ? quest.title : 'Все задания выполнены'}</span>
              {quest && (
                <span className="flex items-center gap-1 mt-0.5">
                  <span className="flex-1 h-1.5 rounded-full bg-black/60 overflow-hidden">
                    <span className="block h-full bg-emerald-500" style={{ width: `${Math.min(100, (quest.current / quest.target) * 100)}%` }} />
                  </span>
                  <span className="text-[9px] text-gray-300 tabular-nums">{Math.min(quest.current, quest.target)}/{quest.target}</span>
                </span>
              )}
            </span>
            <ChevronRight className="w-4 h-4 text-amber-300 shrink-0" />
          </button>
          <button
            onClick={() => setSheet('stones')}
            aria-label="Боевые камни"
            className={`h-10 shrink-0 flex items-center gap-1 rounded-xl border bg-black/60 pl-1 pr-2 active:scale-90 transition-transform ${state.battleStones > 0 ? 'border-amber-400/25' : 'border-red-500/60'}`}
          >
            <img src="/battle-stone.webp" alt="" className="w-7 h-7 object-contain" />
            <span className={`text-xs font-bold tabular-nums ${state.battleStones > 0 ? 'text-white' : 'text-red-300'}`}>{state.battleStones}</span>
          </button>
          <ControlButton label="Скорость боя x2" active={state.settings.speed === 2} onClick={() => setSettings({ speed: state.settings.speed === 2 ? 1 : 2 })}>
            x2
          </ControlButton>
          <ControlButton label="Автобой" active={state.settings.auto} onClick={() => setSettings({ auto: !state.settings.auto })}>
            <Repeat className="w-4 h-4" />
          </ControlButton>
          <ControlButton label="Благословение" active={state.blessing.charges > 0} onClick={bless}>
            <img src="/ic-blessing.webp" alt="" className="w-7 h-7 object-contain" />
            {blessReady && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border border-black animate-pulse" />}
            {state.blessing.charges > 0 && <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-400 text-black text-[9px] font-bold px-1">{state.blessing.charges}</span>}
          </ControlButton>
        </div>
      </div>

      {sheet === 'daily' && <DailySheet onClose={() => setSheet(null)} notify={notify} />}
      {sheet === 'mail' && <MailSheet onClose={() => setSheet(null)} notify={notify} />}
      {sheet === 'settings' && <SettingsSheet onClose={() => setSheet(null)} saveStatus={saveStatus} />}
      {sheet === 'stones' && (
        <StonesSheet
          onClose={() => setSheet(null)}
          onShop={() => onOpen('shop')}
          onDaily={() => setSheet('daily')}
        />
      )}
    </div>
  );
}
