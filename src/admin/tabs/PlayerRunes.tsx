import { useCallback, useEffect, useState } from 'react';
import { AdminError, adminCall } from '@/admin/api';
import { ErrorLine, Panel, inputCls, type Confirm } from '@/admin/ui';
import catalog from '@/game/config/territory-independent-rune-slots-v1.json';

type Request = { playerId: string; runeId: string; level: number; reason: string; requestId: string };
type Receipt = { playerId: string; runeId: string; level: number; previousLevel: number; operationId: string };
type Status = { playerId: string; owned: { runeId: string; level: number }[] };
const options = catalog.slots.flatMap(slot => slot.options.map(rune => ({ ...rune, slot: slot.ordinal })));
const definitive = new Set(['rune_still_equipped', 'rune_operation_reused', 'rune_unknown_id', 'rune_account_unavailable', 'invalid_request']);

export function PlayerRunes({ playerId, playerName, confirm }: { playerId: string; playerName: string; confirm: Confirm }) {
  const key = `territory_rune_admin_pending_${playerId}`;
  const [pending, setPending] = useState<Request | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null') as Request | null;
      return value?.playerId === playerId && typeof value.requestId === 'string' ? value : null;
    } catch { return null; }
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [runeId, setRuneId] = useState(options[0].runeId);
  const [level, setLevel] = useState('1');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const data = await adminCall<Status>('runes_player', { playerId });
    if (data.playerId !== playerId || !Array.isArray(data.owned)) throw new Error('Сервер вернул некорректный список рун.');
    setStatus(data);
  }, [playerId]);
  useEffect(() => { void refresh().catch((e: Error) => setError(e.message)); }, [refresh]);
  const run = async (request: Request) => {
    setBusy(true); setError(null);
    try {
      const receipt = await adminCall<Receipt>('runes_set_level', { ...request });
      if (receipt.playerId !== request.playerId || receipt.runeId !== request.runeId || receipt.level !== request.level || receipt.operationId !== request.requestId)
        throw new Error('Сервер не подтвердил операцию. Повторите тот же запрос.');
      localStorage.removeItem(key); setPending(null);
      await refresh();
      return `Руна ${receipt.runeId}: уровень ${receipt.previousLevel} → ${receipt.level}.`;
    } catch (e) {
      if (e instanceof AdminError && definitive.has(e.code)) { localStorage.removeItem(key); setPending(null); }
      setError(e instanceof Error ? e.message : 'Ошибка связи.');
      throw e;
    } finally { setBusy(false); }
  };
  const submit = () => {
    const n = Number(level), note = reason.trim();
    if (!Number.isInteger(n) || n < 0 || n > 3 || note.length < 4 || note.length > 140) {
      setError('Укажите уровень от 0 до 3 и причину от 4 до 140 символов.'); return;
    }
    const request: Request = { playerId, runeId, level: n, reason: note, requestId: crypto.randomUUID() };
    confirm(`Установить уровень ${n} для «${options.find(o => o.runeId === runeId)?.nameRu}» игроку ${playerName}? Причина: ${note}`, async () => {
      localStorage.setItem(key, JSON.stringify(request)); setPending(request);
      return run(request);
    });
  };
  const owned = status?.owned.find(x => x.runeId === runeId)?.level ?? 0;
  return <Panel title="Руны игрока">
    <p className="text-xs text-slate-400 mb-2">Серверное владение. Уровень 0 отзывает руну; надетую руну сначала нужно снять. Боевые эффекты пока не включены.</p>
    <ErrorLine text={error} />
    {pending ? <div className="space-y-2 mt-2">
      <p className="text-xs text-amber-300">Ответ операции {pending.runeId}, уровень {pending.level}, не подтверждён. Повтор использует тот же идентификатор.</p>
      <button className={inputCls} disabled={busy} onClick={() => void run(pending).catch(() => {})}>Повторить запрос</button>
    </div> : <div className="space-y-2 mt-2">
      <label className="block text-xs text-slate-300">Руна
        <select className={inputCls} value={runeId} onChange={e => setRuneId(e.target.value)}>
          {options.map(o => <option key={o.runeId} value={o.runeId}>{o.slot}. {o.nameRu} — уровень {status?.owned.find(x => x.runeId === o.runeId)?.level ?? 0}</option>)}
        </select>
      </label>
      <p className="text-xs text-slate-300">Текущий уровень: {status ? owned : 'не загружен'}</p>
      <label className="block text-xs text-slate-300">Новый уровень (0–3)
        <input className={inputCls} type="number" min="0" max="3" step="1" value={level} onChange={e => setLevel(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-300">Причина
        <input className={inputCls} maxLength={140} value={reason} onChange={e => setReason(e.target.value)} />
      </label>
      <button className={inputCls} disabled={!status || busy} onClick={submit}>Установить уровень</button>
    </div>}
  </Panel>;
}
