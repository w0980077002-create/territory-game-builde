import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Gift, Mail, RefreshCw, Send, Trash2 } from 'lucide-react';
import { RESOURCES, adminCall, payloadFor, type GrantPayload } from '@/admin/api';
import { Empty, ErrorLine, Loading, Panel, fmtDate, inputCls, type Confirm } from '@/admin/ui';

type Target = 'one' | 'all' | 'active';
type Slot = { key: string; qty: string };
type Delivery = 'now' | 'later';
type Schedule = {
  id: string; target: Target; recipientId: string | null; subject: string;
  sendAt: string; status: 'pending' | 'sent' | 'cancelled';
  sentCount: number; createdAt: string;
};

const TARGETS: { id: Target; label: string; hint: string }[] = [
  { id: 'one', label: 'Конкретному ID', hint: 'Telegram ID или @username' },
  { id: 'all', label: 'Всем игрокам', hint: 'Каждый зарегистрированный игрок' },
  { id: 'active', label: 'Только активным', hint: 'Заходили в игру за последние 7 дней' },
];
const blankSlots = (): Slot[] => Array.from({ length: 3 }, () => ({ key: '', qty: '' }));

export function MailTab({ confirm }: { confirm: Confirm }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [slots, setSlots] = useState<Slot[]>(blankSlots);
  const [target, setTarget] = useState<Target>('active');
  const [recipient, setRecipient] = useState('');
  const [delivery, setDelivery] = useState<Delivery>('now');
  const [sendLocal, setSendLocal] = useState('');
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await adminCall<{ rows: Schedule[] }>('mail_schedules');
      setSchedules(result.rows);
      setListError(null);
    } catch (e) {
      setListError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const updateSlot = (index: number, changes: Partial<Slot>) => {
    setSlots((current) => current.map((slot, i) => i === index ? { ...slot, ...changes } : slot));
  };

  const clearForm = () => {
    setSubject(''); setBody(''); setSlots(blankSlots()); setSendLocal('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return setError('Заполни тему и текст письма.');
    if (target === 'one' && !recipient.trim()) return setError('Укажи Telegram ID или @username получателя.');

    const payload: GrantPayload = {};
    const selected = new Set<string>();
    const rewardLabels: string[] = [];
    for (const slot of slots) {
      if (!slot.key) {
        if (slot.qty.trim()) return setError('Выбери награду для указанного количества.');
        continue;
      }
      if (selected.has(slot.key)) return setError('Выбирай разные награды в трёх строках.');
      selected.add(slot.key);
      const qty = Number(slot.qty);
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 100_000) {
        return setError('Количество каждой награды — целое число от 1 до 100 000.');
      }
      const part = payloadFor(slot.key, qty);
      if (part.items) payload.items = { ...payload.items, ...part.items };
      for (const key of ['gold', 'gems', 'redGems', 'stones', 'forgeMaterials'] as const) {
        if (part[key] !== undefined) payload[key] = part[key];
      }
      rewardLabels.push(`${RESOURCES.find((r) => r.key === slot.key)?.label} × ${qty}`);
    }

    let sendAt: string | undefined;
    if (delivery === 'later') {
      const parsed = new Date(sendLocal);
      if (!sendLocal || !Number.isFinite(parsed.getTime()) ||
        parsed.getTime() < Date.now() + 90_000 || parsed.getTime() > Date.now() + 365 * 86_400_000) {
        return setError('Выбери дату и время не раньше чем через 2 минуты и не дальше чем через год.');
      }
      sendAt = parsed.toISOString();
    }
    setError(null);
    const who = target === 'one' ? `игроку ${recipient.trim()}`
      : target === 'all' ? 'ВСЕМ игрокам' : 'активным игрокам за 7 дней';
    const gifts = rewardLabels.length ? rewardLabels.join(', ') : 'без наград';
    const when = sendAt ? `в ${fmtDate(sendAt)} (время устройства)` : 'сейчас';
    confirm(`Отправить письмо «${subject.trim()}» ${who} ${when}? Награды: ${gifts}`, async () => {
      const result = sendAt
        ? await adminCall<{ id: string }>('mail_schedule', { subject, body, payload, target, recipient, sendAt })
        : await adminCall<{ sent: number }>('mail', { subject, body, payload, target, recipient });
      clearForm();
      await refresh();
      return sendAt ? 'Рассылка поставлена в очередь. Отправка выполняется сервером.'
        : `Письмо отправлено: ${'sent' in result ? result.sent : 0} получателей`;
    });
  };

  const cancel = (schedule: Schedule) => {
    confirm(`Отменить запланированное письмо «${schedule.subject}»?`, async () => {
      await adminCall('mail_schedule_cancel', { id: schedule.id });
      await refresh();
      return 'Рассылка отменена.';
    });
  };

  return <div className="space-y-4">
    <Panel title="Новое письмо" icon={<Mail className="w-4 h-4" />}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="block text-xs text-slate-400 mb-1">Тема письма</span>
          <input className={inputCls} maxLength={80} value={subject}
            onChange={(e) => setSubject(e.target.value)} placeholder="С праздником!" />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-400 mb-1">Текст сообщения</span>
          <textarea className={`${inputCls} h-32 py-2.5 resize-none`} maxLength={1000}
            value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Дорогие герои! Поздравляем вас..." />
          <span className="block text-right text-[10px] text-slate-500 mt-0.5">{body.length}/1000</span>
        </label>

        <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
            <Gift className="w-4 h-4" /> Награды (до трёх разных)
          </div>
          {slots.map((slot, index) => (
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2" key={index}>
              <label className="block min-w-0">
                <span className="block text-[11px] text-slate-400 mb-1">Награда {index + 1}</span>
                <select className={inputCls} value={slot.key}
                  onChange={(e) => updateSlot(index, { key: e.target.value, qty: e.target.value ? slot.qty : '' })}>
                  <option value="">Без награды</option>
                  {RESOURCES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] text-slate-400 mb-1">Количество</span>
                <input className={inputCls} type="number" inputMode="numeric" step={1} min={1} max={100000}
                  value={slot.qty} onChange={(e) => updateSlot(index, { qty: e.target.value })}
                  disabled={!slot.key} placeholder="0" />
              </label>
            </div>
          ))}
          <p className="text-[11px] text-slate-400">Все выбранные награды игрок получит из одного письма.</p>
        </div>

        <fieldset>
          <legend className="text-xs text-slate-400 mb-1.5">Кому отправить</legend>
          <div className="space-y-1.5">
            {TARGETS.map((t) => (
              <label key={t.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${target === t.id ? 'border-sky-500/60 bg-sky-500/10' : 'border-slate-700/60 bg-slate-950/50'}`}>
                <input type="radio" name="target" checked={target === t.id} onChange={() => setTarget(t.id)} className="w-4 h-4 accent-sky-500" />
                <span><span className="block text-sm font-semibold text-slate-100">{t.label}</span>
                  <span className="block text-[11px] text-slate-400">{t.hint}</span></span>
              </label>
            ))}
          </div>
          {target === 'one' && (
            <input className={`${inputCls} mt-2`} value={recipient}
              onChange={(e) => setRecipient(e.target.value)} placeholder="Telegram ID или @username" />
          )}
        </fieldset>

        <fieldset className="rounded-xl border border-slate-700/70 p-3 space-y-2">
          <legend className="text-xs font-semibold text-sky-200 px-1">Когда отправить</legend>
          <label className="flex items-center gap-2 text-sm text-slate-100">
            <input type="radio" name="delivery" checked={delivery === 'now'} onChange={() => setDelivery('now')} />
            Отправить сразу
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-100">
            <input type="radio" name="delivery" checked={delivery === 'later'} onChange={() => setDelivery('later')} />
            Запланировать дату и время
          </label>
          {delivery === 'later' && <>
            <label className="block text-xs text-slate-400">Дата и время (часовой пояс устройства)
              <input type="datetime-local" className={`${inputCls} mt-1`} value={sendLocal}
                onChange={(e) => setSendLocal(e.target.value)} />
            </label>
            <p className="text-[11px] text-slate-400">Время сохраняется на сервере. Отправка запускается автоматически, даже когда админка закрыта. Возможна задержка до минуты.</p>
          </>}
        </fieldset>

        <ErrorLine text={error} />
        <button className="w-full h-12 rounded-xl bg-gradient-to-b from-sky-500 to-sky-700 text-sm font-bold text-white hover:brightness-110 flex items-center justify-center gap-2">
          {delivery === 'later' ? <CalendarClock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          {delivery === 'later' ? 'Запланировать рассылку' : 'Отправить письмо'}
        </button>
        <p className="text-[11px] text-slate-500 text-center">Письмо появится во внутриигровой почте. Награды можно забрать там.</p>
      </form>
    </Panel>
    <Panel title="Запланированные и отправленные" icon={<CalendarClock className="w-4 h-4" />} right={
      <button type="button" aria-label="Обновить рассылки" onClick={() => void refresh()}
        className="text-slate-400 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
    }>
      <ErrorLine text={listError} />
      {schedules === null ? <Loading /> : schedules.length === 0 ? <Empty text="Отложенных рассылок пока нет." /> :
        <div className="space-y-2">{schedules.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-700/60 bg-slate-950/50 p-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <strong className="block text-xs text-white truncate">{s.subject}</strong>
              <span className="block text-[11px] text-slate-400">{fmtDate(s.sendAt)} · {
                s.target === 'one' ? 'Один игрок' : s.target === 'all' ? 'Все игроки' : 'Активные за неделю'
              }</span>
              <span className={`text-[11px] ${s.status === 'pending' ? 'text-amber-300' : s.status === 'sent' ? 'text-emerald-300' : 'text-slate-400'}`}>
                {s.status === 'pending' ? 'Ожидает отправки' : s.status === 'sent' ? `Отправлено: ${s.sentCount} игрокам` : 'Отменено'}
              </span>
            </div>
            {s.status === 'pending' && (
              <button type="button" title="Отменить рассылку" onClick={() => cancel(s)}
                className="w-9 h-9 rounded-lg border border-red-500/30 text-red-300 shrink-0 flex items-center justify-center">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}</div>}
    </Panel>
  </div>;
}
