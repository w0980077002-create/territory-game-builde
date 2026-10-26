import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Trophy, RefreshCw } from 'lucide-react';
import { adminCall } from '@/admin/api';
import { Panel, ErrorLine, Loading, inputCls, type Confirm } from '@/admin/ui';
import type { SeasonPrize } from '@/game/seasonApi';
interface Configuration {
  enabled: boolean; revision: number; prizes: SeasonPrize[]; current_prizes: SeasonPrize[];
  current_week: string | null; next_week: string;
}
export function SeasonAdminTab({ confirm }: { confirm: Confirm }) {
  const [status, setStatus] = useState<Configuration | null>(null);
  const [draft, setDraft] = useState<{ gold: string; gems: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ requestId: string; revision: number; prizes: SeasonPrize[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const next = await adminCall<Configuration>('season_status');
      setStatus(next); setDraft(next.prizes.map(p => ({ gold: String(p.gold ?? ''), gems: String(p.gems ?? '') })));
      setPending(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (!status) return;
    const prizes = draft.map(row => ({ ...(row.gold ? { gold: Number(row.gold) } : {}), ...(row.gems ? { gems: Number(row.gems) } : {}) }));
    if (!prizes.length || prizes.some(p => !Object.keys(p).length || Object.values(p).some(v => !Number.isSafeInteger(v) || v <= 0 || v > 999_999_999))) {
      setError('Заполни положительные целые суммы хотя бы одной валюты для каждого места.'); return;
    }
    const operation = pending && pending.revision === status.revision && JSON.stringify(pending.prizes) === JSON.stringify(prizes)
      ? pending : { requestId: crypto.randomUUID(), revision: status.revision, prizes };
    setPending(operation);
    confirm(`Сохранить награды с недели ${status.next_week}? Текущий сезон и уже выданные призы сохранят свои суммы.`, async () => {
      const next = await adminCall<Configuration>('season_prizes', operation);
      setStatus(next); setPending(null); setError(null);
      return `Награды сохранены для следующего сезона: ${next.next_week}`;
    });
  };
  return <Panel title="Недельный чемпионат · призы" icon={<Trophy size={18} />}
    right={<button type="button" disabled={loading} onClick={() => void refresh()} aria-label="Обновить"><RefreshCw size={18} /></button>}>
    <ErrorLine text={error} />
    {!status ? loading ? <Loading /> : null : <div className="space-y-4">
      <p className="text-sm text-slate-300">{status.enabled ? 'Чемпионат включён' : 'Чемпионат не запущен'}. Неделя: воскресенье → воскресенье, 00:00 по Киеву. Призы доставляются почтой однократно.</p>
      {!!status.current_prizes.length && <div className="rounded-xl border border-amber-500/30 p-3 space-y-1">
        <h3 className="text-sm font-bold text-amber-200">Текущий сезон · {status.current_week}</h3>
        {status.current_prizes.map((p, i) => <div key={i} className="flex justify-between gap-2 text-xs"><b>#{i + 1}</b><span>{p.gold ?? 0} золота · {p.gems ?? 0} синих алмазов</span></div>)}
      </div>}
      <form onSubmit={submit} className="space-y-3">
        <h3 className="text-sm font-bold">Следующий сезон · {status.next_week}</h3>
        <p className="text-xs text-slate-400">Изменения применяются при открытии нового сезона. Начатый сезон и история победителей не меняются.</p>
        <div className="grid grid-cols-[2rem_1fr_1fr] gap-2 text-xs text-slate-400"><span>Место</span><span>Золото</span><span>Синие алмазы</span></div>
        {draft.map((row, i) => <div key={i} className="grid grid-cols-[2rem_1fr_1fr] gap-2 items-center">
          <b className="text-amber-200 text-sm">#{i + 1}</b>
          {(['gold', 'gems'] as const).map(key => <input key={key} aria-label={`${key === 'gold' ? 'Золото' : 'Синие алмазы'} за место ${i + 1}`}
            className={inputCls} type="number" min="1" max="999999999" step="1" value={row[key]}
            onChange={e => setDraft(old => old.map((p, index) => index === i ? { ...p, [key]: e.target.value } : p))} />)}
        </div>)}
        <button disabled={loading || !draft.length} className="w-full h-12 rounded-xl bg-sky-600 font-bold text-sm disabled:opacity-50">Сохранить призы следующего сезона</button>
      </form>
    </div>}
  </Panel>;
}
