import { useCallback, useEffect, useState } from 'react';
import { adminCall } from '@/admin/api';
import { ErrorLine, Panel } from '@/admin/ui';

type Status = { eligible: number; granted: number; pending: number; unexpected: number; duplicates: number; lastGrant: string | null; failureAuditAvailable: boolean };
export function HalloweenRewardTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await adminCall<Status>('halloween_reward_status');
      if (![result.eligible, result.granted, result.pending, result.unexpected, result.duplicates].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Некорректный ответ сервера');
      setStatus(result); setError(null);
    } catch (e) { setStatus(null); setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <Panel title="Награда рейда Halloween 2026">
    <p className="text-sm text-slate-300">Только серверные агрегаты. Дозачисление выполняется по защищённой инструкции оператора после проверок.</p>
    <button type="button" disabled={busy} onClick={() => void load()} className="mt-3 rounded bg-slate-700 px-3 py-2 text-white disabled:opacity-50">Обновить сверку</button>
    <ErrorLine text={error} />
    {status && <div className="mt-3 space-y-1 text-sm text-slate-200">
      <p>Участников: {status.eligible} · Выдано: {status.granted} · Ожидают: {status.pending}</p>
      <p>Неожиданные права: {status.unexpected} · Дубликаты: {status.duplicates}</p>
      <p>Последний пакет: {status.lastGrant ?? 'нет'}</p>
      {!status.failureAuditAvailable && <p>Счётчик ошибок и последняя ошибка не подключены; проверяйте защищённый журнал оператора.</p>}
    </div>}
  </Panel>;
}
