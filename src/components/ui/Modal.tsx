import { useLanguage } from '@/game/i18n';
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

/**
 * A native iPhone WebView can place fixed descendants of a scrolling main pane
 * underneath the game's persistent footer. Portal dialogs directly into the
 * relative game shell on iOS only; keep Android and desktop DOM unchanged.
 */
export function IosGamePortal({ children }: { children: ReactNode }) {
  const host = typeof document !== 'undefined'
    && document.documentElement.classList.contains('territory-ios-webapp')
      ? document.querySelector<HTMLElement>('.territory-shell')
      : null;
  return host ? createPortal(children, host) : <>{children}</>;
}

interface Props {
  title: string;
  icon?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, icon, onClose, children }: Props) {
  const { language } = useLanguage();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <IosGamePortal>
    <div className="territory-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <button aria-label={language === 'en' ? 'Close' : 'Закрыть'} className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="territory-modal-panel relative w-full max-w-md flex flex-col rounded-t-3xl sm:rounded-3xl border border-amber-500/25 bg-gradient-to-b from-[#1d2330] to-[#11151d] shadow-2xl shadow-black animate-sheet-up">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10 shrink-0">
          {icon && <img src={icon} alt="" className="w-8 h-8 object-contain" />}
          <h2 className="flex-1 text-base font-bold text-amber-100 truncate">{title}</h2>
          <button
            onClick={onClose}
            aria-label={language === 'en' ? 'Close' : 'Закрыть'}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto scrollbar-hide p-4 pb-[max(16px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
    </IosGamePortal>
  );
}
