import { useEffect, useState } from 'react';
import { getMortarionBossState, type MortarionState } from '@/game/mortarionBoss';
import { formatMortarionCityCountdown, mortarionCityTimeRemaining } from '@/game/mortarionCityClock';
import { useLanguage } from '@/game/i18n';
import './mortarionCityShortcut.css';

type RaidSnapshot = { raid: MortarionState; receivedAt: number };

/** The raid lives in City, just below the campaign chapters.
 * Read-only status polling: no hits, claim RPCs or economy mutations here. */
export function MortarionCityShortcut({ onOpen }: { onOpen: () => void }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [snapshot, setSnapshot] = useState<RaidSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void getMortarionBossState()
        .then(raid => {
          if (mounted) setSnapshot({ raid, receivedAt: performance.now() });
        })
        .catch(() => { /* Failed status reads never block City's other controls. */ })
        .finally(() => { pending = false; });
    };
    refresh();
    const clock = window.setInterval(() => setTick(performance.now()), 1_000);
    const polling = window.setInterval(refresh, 30_000);
    const resume = () => {
      if (document.visibilityState === 'visible') {
        setTick(performance.now());
        refresh();
      }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      mounted = false;
      window.clearInterval(clock);
      window.clearInterval(polling);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, []);

  if (!snapshot?.raid.enabled) return null;
  const { raid, receivedAt } = snapshot;
  const now = tick >= receivedAt ? tick : performance.now();
  const remaining = mortarionCityTimeRemaining(raid.endsAt, raid.serverNow, receivedAt, now);
  if (remaining === null) return null;
  const defeated = raid.hp === 0;
  const closed = defeated || remaining === 0;
  const startsInFuture = Date.parse(raid.startsAt) > Date.parse(raid.serverNow) + Math.max(0, now - receivedAt);
  const detail = defeated
    ? (en ? 'DEFEATED · REWARDS' : 'ПОБЕЖДЁН · НАГРАДЫ')
    : closed ? (en ? 'FINISHED · REWARDS' : 'ЗАВЕРШЁН · НАГРАДЫ')
      : startsInFuture ? (en ? 'STARTING SOON' : 'СКОРО НАЧНЁТСЯ')
        : formatMortarionCityCountdown(remaining, en);

  return <div className="home-mortarion-shortcut">
    <button type="button" onClick={onOpen} data-testid="city-mortarion-raid"
      className="home-mortarion-shortcut__button"
      aria-label={en ? `Mortarion, Lord of Souls. ${detail}. Open raid` : `Мортарион, Властелин душ. ${detail}. Открыть рейд`}>
      <img src={import.meta.env.BASE_URL + 'assets/territory/events/mortarion-boss-layer.webp'}
        alt="" className="home-mortarion-shortcut__art" draggable={false} decoding="async" />
      <span className="home-mortarion-shortcut__copy">
        <strong>{en ? 'MORTARION' : 'МОРТАРИОН'}</strong>
        <span className="home-mortarion-shortcut__time" role="timer" aria-live="off">
          <span aria-hidden="true">⌛</span> {detail}
        </span>
      </span>
    </button>
  </div>;
}
