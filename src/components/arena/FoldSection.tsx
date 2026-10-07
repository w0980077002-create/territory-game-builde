import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function FoldSection({ title, summary, open, onToggle, children }: Props) {
  return (
    <div className="rounded-xl border border-amber-500/15 bg-gray-900/70 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-2.5 h-8 text-left transition-colors hover:bg-white/[0.03]">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300/90 truncate shrink-0">{title}</span>
        <span className="flex-1 min-w-0 flex items-center justify-end gap-1 overflow-hidden">{!open && summary}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-2 pb-2 animate-fade-in">{children}</div>}
    </div>
  );
}
