import { useCallback, useEffect, useState } from 'react';
import { adminCall } from '@/admin/api';
import { ErrorLine, Panel } from '@/admin/ui';

type Snapshot = { eligible: number; granted: number; pending: number; unexpected: number; duplicates: number; lastGrant: string | null };
type Status = { snapshot: Snapshot | null; audit: { failed: number; unfinished: number; lastError: string | null; lastErrorAt: string | null } };
export function HalloweenRewardTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await adminCall<Status>('halloween_reward_status');
      if (!result.audit || ![result.audit.failed, result.audit.unfinished].every(n => Number.isSafeInteger(n) && n >= 0)
          || (result.snapshot && ![result.snapshot.eligible, result.snapshot.granted, result.snapshot.pending, result.snapshot.unexpected, result.snapshot.duplicates].every(n => Number.isSafeInteger(n) && n >= 0))) throw new Error('Некорректный ответ сервера');
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
      {status.snapshot ? <>
        <p>Участников: {status.snapshot.eligible} · Выдано: {status.snapshot.granted} · Ожидают: {status.snapshot.pending}</p>
        <p>Неожиданные права: {status.snapshot.unexpected} · Дубликаты: {status.snapshot.duplicates}</p>
        <p>Последний пакет: {status.snapshot.lastGrant ?? 'нет'}</p>
      </> : <p>Снимок недоступен: событие ещё не завершено либо серверная часть недоступна.</p>}
      <p>Отказов: {status.audit.failed} · Незавершённых попыток: {status.audit.unfinished}</p>
      <p>Последняя ошибка: {status.audit.lastError ?? 'нет'} {status.audit.lastErrorAt ?? ''}</p>
    </div>}
  </Panel>;
}
