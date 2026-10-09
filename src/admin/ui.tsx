import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

export type Confirm = (question: string, action: () => Promise<string>) => void;

export function Panel({ title, icon, children, right }: { title: string; icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 shadow-lg shadow-black/30">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-sky-400">{icon}</span>}
        <h2 className="text-sm font-semibold text-slate-100 flex-1">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Switch({ label, hint, on, onToggle, tone = 'sky' }: { label: string; hint: string; on: boolean; onToggle: () => void; tone?: 'sky' | 'red' | 'emerald' | 'amber' }) {
  const color = { sky: 'bg-sky-500', red: 'bg-red-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500' }[tone];
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3 py-3 text-left hover:border-slate-500 transition-colors">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-slate-100">{label}</span>
        <span className="block text-xs text-slate-400 leading-relaxed">{hint}</span>
      </span>
      <span className={`shrink-0 w-12 h-7 rounded-full p-0.5 transition-colors ${on ? color : 'bg-slate-700'}`}>
        <span className={`block w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  );
}

export function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{text}</p>;
}

export function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-xs text-slate-500">{text}</p>;
}

export function ConfirmDialog({ question, busy, onYes, onNo }: { question: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in" onClick={busy ? undefined : onNo}>
      <div className="w-full max-w-sm rounded-2xl border border-amber-500/40 bg-slate-900 p-5 shadow-2xl animate-pop" onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-amber-500/15 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-amber-400" />
        </div>
        <h3 className="text-center text-lg font-bold text-white mb-1">Вы уверены?</h3>
        <p className="text-center text-sm text-slate-300 mb-5 break-words">{question}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onNo} disabled={busy} className="h-11 rounded-xl border border-slate-600 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50 transition-colors">Отмена</button>
          <button onClick={onYes} disabled={busy} className="h-11 rounded-xl bg-amber-500 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Да, выполнить
          </button>
        </div>
      </div>
    </div>
  );
}

export const inputCls = 'w-full h-11 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors';

export const fmt = (n: number) => n.toLocaleString('ru-RU');

export function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
