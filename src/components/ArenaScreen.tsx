import { useEffect, useState } from 'react';
import { ChevronLeft, Crown, Loader2 } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame, useAccount } from '@/game/actions';
import { getAppearanceIcon } from '@/game/appearance';
import { Currency, formatAmount } from '@/components/ui/Currency';
import { useLanguage } from '@/game/i18n';
import { currentArenaRoom } from '@/game/arenaApi';
import { ArenaLobby } from './arena/ArenaLobby';
import { ArenaRoom } from './arena/ArenaRoom';
import './arena/arenaLobby.css';

interface Props {
  onActiveChange?: (active: boolean) => void;
  onBack?: () => void;
  backDisabled?: boolean;
}

export function ArenaScreen({ onActiveChange, onBack, backDisabled }: Props) {
  const state = useStore(useGame);
  const account = useStore(useAccount);
  const { language, setLanguage } = useLanguage();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const player = state.player;
  const remainingVip = Math.max(0, account.vipRemaining - (performance.now() - account.vipCheckedAt));
  const vip = Math.max(account.permanentVip, remainingVip > 0 ? account.vip : 0);
  const xpPct = player.xpToNext > 0 ? Math.min(100, Math.max(0, player.xp / player.xpToNext * 100)) : 100;

  useEffect(() => {
    let mounted = true;
    currentArenaRoom()
      .then((id) => { if (mounted) setRoomId(id ?? null); })
      .catch(() => { if (mounted) setRoomId(null); })
      .finally(() => { if (mounted) setChecking(false); });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="arena-screen-shell -mx-3 -my-3">
      <div className="arena-global-hud">
        <div className="arena-global-profile">
          <span className="arena-global-avatar"><img src={getAppearanceIcon(state.appearance)} alt="" /></span>
          <span className="arena-global-identity">
            <strong title={player.name}>{player.name}</strong>
            <span className="arena-global-level">{language === 'en' ? 'Lv.' : 'Ур.'} {player.level}
              <span className="arena-global-vip"><Crown className="h-3 w-3" />VIP {vip}</span>
            </span>
            <span className="arena-global-xp"><i style={{ width: `${xpPct}%` }} /></span>
          </span>
        </div>
        <div className="arena-global-actions">
          <div className="arena-global-wallet">
            <span><Currency kind="gold" value={formatAmount(player.gold)} size={17} className="text-white" /></span>
            <span><Currency kind="gems" value={formatAmount(player.gems)} size={17} className="text-white" /></span>
            <span><Currency kind="redGems" value={formatAmount(player.redGems)} size={17} className="text-white" /></span>
          </div>
          <button type="button" aria-label={language === 'en' ? 'Switch to Russian' : 'Switch to English'}
            onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')} className="arena-global-lang">{language.toUpperCase()}</button>
        </div>
      </div>
      <div className="arena-global-subnav">
        <button type="button" disabled={backDisabled} onClick={onBack} className="arena-global-back"><ChevronLeft className="h-4 w-4" />{language === 'en' ? 'City' : 'Город'}</button>
        <span className="arena-global-subtitle">{language === 'en' ? 'VIKING ARENA' : 'АРЕНА ВИКИНГОВ'}</span>
      </div>
      {checking ? (
        <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-amber-300" /></div>
      ) : roomId ? (
        <div className="px-3 py-2"><ArenaRoom key={roomId} roomId={roomId} onExit={() => setRoomId(null)} onActiveChange={onActiveChange} /></div>
      ) : <ArenaLobby onJoined={setRoomId} />}
    </div>
  );
}
