import { useLanguage } from '@/game/i18n';
import { useEffect, useId, useRef, type ReactNode } from 'react';
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
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // DOM order also works when parent and child mount in the same render,
      // where React can run the child's effect before the parent's effect.
      const dialogs = document.querySelectorAll('.territory-modal[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== modalRef.current) return;
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter(el => el.getClientRects().length > 0);
      if (!focusable.length) { e.preventDefault(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus();
    };
  }, []);

  return (
    <IosGamePortal>
    <div ref={modalRef} className="territory-modal fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button aria-label={language === 'en' ? 'Close' : 'Закрыть'} className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div ref={panelRef} className="territory-modal-panel relative flex flex-col shadow-2xl shadow-black">
        <div className="territory-modal-head flex items-center gap-2.5 shrink-0">
          {icon && <img src={icon} alt="" className="w-8 h-8 object-contain" />}
          <h2 id={titleId} className="flex-1">{title}</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label={language === 'en' ? 'Close' : 'Закрыть'}
            className="territory-modal-close flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="territory-modal-content overflow-y-auto p-4" tabIndex={0}>{children}</div>
      </div>
    </div>
    </IosGamePortal>
  );
}
