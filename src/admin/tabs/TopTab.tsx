import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { adminCall } from '@/admin/api';
import { Empty, ErrorLine, Loading, Panel, fmt } from '@/admin/ui';

type Kind = 'level' | 'gold' | 'donate';

interface TopRow {
  id: string;
  telegramId: number | null;
  name: string;
  username: string | null;
  value: number;
}

const KINDS: { id: Kind; label: string; unit: (v: number) => string }[] = [
  { id: 'level', label: 'По уровню', unit: (v) => `ур. ${v}` },
  { id: 'gold', label: 'По монетам', unit: (v) => fmt(v) },
  { id: 'donate', label: 'По донату', unit: (v) => `$${v.toFixed(2)}` },
];

const PAGE = 20;
const MEDALS = ['text-amber-300 bg-amber-500/20', 'text-slate-200 bg-slate-400/20', 'text-orange-300 bg-orange-600/20'];

export function TopTab() {
  const [kind, setKind] = useState<Kind>('level');
  const [rows, setRows] = useState<TopRow[] | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setPage(0);
    setError(null);
    adminCall<{ rows: TopRow[] }>('top', { kind }).then((r) => setRows(r.rows)).catch((e: Error) => setError(e.message));
  }, [kind]);

  const meta = KINDS.find((k) => k.id === kind)!;
  const pages = rows ? Math.max(1, Math.ceil(rows.length / PAGE)) : 1;
  const visible = rows?.slice(page * PAGE, page * PAGE + PAGE) ?? [];

  return (
    <Panel title="Топ-100 игроков" icon={<Trophy className="w-4 h-4 text-amber-400" />}>
      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/60 border border-slate-800 mb-3">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)} className={`h-9 rounded-lg text-xs font-semibold transition-colors ${kind === k.id ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {k.label}
          </button>
        ))}
      </div>
      <ErrorLine text={error} />
      {!rows ? (!error && <Loading />) : rows.length === 0 ? <Empty text="Пока пусто" /> : (
        <>
          <ol className="space-y-1.5">
            {visible.map((r, i) => {
              const pos = page * PAGE + i;
              return (
                <li key={r.id} className="flex items-center gap-3 rounded-xl bg-slate-950/50 border border-slate-800 px-3 py-2">
                  <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold ${MEDALS[pos] ?? 'text-slate-400 bg-slate-800'}`}>{pos + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-white truncate">{r.name ?? '—'}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{r.username ? `@${r.username} · ` : ''}TG {r.telegramId ?? '—'}</span>
                  </span>
                  <span className="text-sm font-bold text-sky-300 tabular-nums">{meta.unit(Number(r.value))}</span>
                </li>
              );
            })}
          </ol>
          {pages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="h-9 px-3 rounded-lg border border-slate-700 text-sm text-slate-200 disabled:opacity-30 flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Назад</button>
              <span className="text-xs text-slate-400">{page + 1} / {pages}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages - 1} className="h-9 px-3 rounded-lg border border-slate-700 text-sm text-slate-200 disabled:opacity-30 flex items-center gap-1">Далее <ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
