import { CURRENCY_ART } from '@/game/art';
import { useLanguage } from '@/game/i18n';

export type CurrencyKind = keyof typeof CURRENCY_ART;

export const CURRENCY_NAME: Record<CurrencyKind, string> = {
  gold: 'Монеты',
  gems: 'Синие кристаллы',
  redGems: 'Красные кристаллы',
  stones: 'Боевые камни',
  material: 'Материалы',
};

export function Currency({ kind, value, size = 16, className = '' }: { kind: CurrencyKind; value: number | string; size?: number; className?: string }) {
  const { language } = useLanguage();
  const names = language === 'en' ? { gold: 'Coins', gems: 'Blue crystals', redGems: 'Red crystals', stones: 'Battle stones', material: 'Materials' } : CURRENCY_NAME;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums font-semibold ${className}`}>
      <img src={CURRENCY_ART[kind]} alt={names[kind]} style={{ width: size, height: size }} className="object-contain shrink-0" />
      {value}
    </span>
  );
}

export function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.floor(n / 1000)}K`;
  return String(n);
}
