import type { ReactNode } from 'react';
import './woodenPlaque.css';

type Props = {
  children: ReactNode;
  variant?: 'logo' | 'section';
  className?: string;
};

/** One reusable wooden sign, with real text kept sharp and translatable. */
export function WoodenPlaque({ children, variant = 'section', className = '' }: Props) {
  return (
    <span className={`territory-wooden-plaque territory-wooden-plaque--${variant} ${className}`}>
      <img
        src={`${import.meta.env.BASE_URL}assets/territory/ui/wooden-plaque.webp`}
        draggable={false}
        aria-hidden="true"
        alt=""
      />
      <span className="territory-wooden-plaque__label">{children}</span>
    </span>
  );
}
