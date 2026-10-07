import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  icon?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, icon, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <button aria-label="Закрыть" className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[86vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-amber-500/25 bg-gradient-to-b from-[#1d2330] to-[#11151d] shadow-2xl shadow-black animate-sheet-up">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10 shrink-0">
          {icon && <img src={icon} alt="" className="w-8 h-8 object-contain" />}
          <h2 className="flex-1 text-base font-bold text-amber-100 truncate">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto scrollbar-hide p-4 pb-[max(16px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
