import { useCallback, useEffect, useState } from 'react';
import { adminCall } from '@/admin/api';
import { ErrorLine, Panel } from '@/admin/ui';

type Snapshot = { eligible: number; granted: number; pending: number; unexpected: number; duplicates: number; lastGrant: string | null };
type Status = { snapshot: Snapshot | null; audit: { failed: number; unfinished: number; lastError: string | null; lastErrorAt: string | null } };
type BonusSnapshot = { eligible: number; sent: number; pending: number; claimed: number; unexpected: number; duplicates: number; lastGrant: string | null };
export function HalloweenRewardTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [bonus, setBonus] = useState<BonusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await adminCall<Status>('halloween_reward_status');
      if (!result.audit || ![result.audit.failed, result.audit.unfinished].every(n => Number.isSafeInteger(n) && n >= 0)
          || (result.snapshot && ![result.snapshot.eligible, result.snapshot.granted, result.snapshot.pending, result.snapshot.unexpected, result.snapshot.duplicates].every(n => Number.isSafeInteger(n) && n >= 0))) throw new Error('Некорректный ответ сервера');
      setStatus(result); setError(null);
      // Independent optional status: never break the approved Witch dashboard if bonus is staged.
      try {
        const b = await adminCall<{ snapshot: BonusSnapshot | null }>('halloween_top10_status');
        if (b.snapshot && [b.snapshot.eligible,b.snapshot.sent,b.snapshot.pending,b.snapshot.claimed,b.snapshot.unexpected,b.snapshot.duplicates]
            .every(v => Number.isSafeInteger(v) && v >= 0)) setBonus(b.snapshot);
        else setBonus(null);
      } catch { setBonus(null); }
    } catch (e) { setStatus(null); setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <Panel title="Награда рейда Halloween 2026">
    <p className="text-sm text-slate-300">Только серверные агрегаты. Дозачисление выполняется по защищённой инструкции оператора после проверок.</p>
    <button type="button" disabled={busy} onClick={() => void load()} className="mt-3 rounded bg-slate-700 px-3 py-2 text-white disabled:opacity-50">Обновить сверку</button>
    <ErrorLine text={error} />
    {status && <div className="mt-3 space-y-1 text-sm text-slate-200">
      {status.snapshot ? <>
        <p>Участников: {status.snapshot.eligible} · Выдано: {status.snapshot.granted} · Ожидают: {status.snapshot.pending}</p>
        <p>Неожиданные права: {status.snapshot.unexpected} · Дубликаты: {status.snapshot.duplicates}</p>
        <p>Последний пакет: {status.snapshot.lastGrant ?? 'нет'}</p>
      </> : <p>Снимок недоступен: событие ещё не завершено либо серверная часть недоступна.</p>}
      <p>Отказов: {status.audit.failed} · Незавершённых попыток: {status.audit.unfinished}</p>
      <p>Последняя ошибка: {status.audit.lastError ?? 'нет'} {status.audit.lastErrorAt ?? ''}</p>
      <div className="mt-3 border-t border-slate-600/50 pt-3">
        <strong className="text-amber-200">Дополнительные призы топ‑10</strong>
        {bonus ? <>
          <p>Победителей: {bonus.eligible} · Писем с призами: {bonus.sent} · Ожидают: {bonus.pending}</p>
          <p>Забрано: {bonus.claimed} · Ошибочных: {bonus.unexpected} · Дубликатов: {bonus.duplicates}</p>
          <p>Последняя выдача: {bonus.lastGrant ?? 'нет'}</p>
        </> : <p>Ожидается закрытие рейда или установка серверного механизма.</p>}
      </div>
    </div>}
  </Panel>;
}
