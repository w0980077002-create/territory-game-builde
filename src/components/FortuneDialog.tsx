import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/game/i18n';

/** Compact native dialog. Rules scroll inside the panel; controls always remain visible. */
export function FortuneDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { language } = useLanguage();
  const closeLabel = language === 'en' ? 'Close' : 'Закрыть';

  useEffect(() => {
    const dialog = ref.current;
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      prior?.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={ref} className="fortune-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="fortune-dialog__head">
      <h2>{title}</h2>
      <button ref={closeRef} type="button" className="fortune-dialog__close" aria-label={closeLabel} onClick={onClose}><X size={21}/></button>
    </div>
    <div className="fortune-dialog__body">{children}</div>
    <div className="fortune-dialog__foot">
      <button type="button" className="fortune-button" onClick={onClose}>OK</button>
    </div>
  </dialog>;
}
