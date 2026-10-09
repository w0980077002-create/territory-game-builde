import { useState, type FormEvent } from 'react';
import { Mail, Send } from 'lucide-react';
import { RESOURCES, adminCall, payloadFor } from '@/admin/api';
import { ErrorLine, Panel, inputCls, type Confirm } from '@/admin/ui';

type Target = 'one' | 'all' | 'active';

const TARGETS: { id: Target; label: string; hint: string }[] = [
  { id: 'one', label: 'Конкретному ID', hint: 'Telegram ID или @username' },
  { id: 'all', label: 'Всем игрокам', hint: 'Каждый зарегистрированный игрок' },
  { id: 'active', label: 'Только активным', hint: 'Заходили в игру за последние 7 дней' },
];

export function MailTab({ confirm }: { confirm: Confirm }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reward, setReward] = useState('');
  const [qty, setQty] = useState('');
  const [target, setTarget] = useState<Target>('active');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = Math.floor(Number(qty));
    if (!subject.trim() || !body.trim()) return setError('Заполните тему и текст письма');
    if (reward && (!amount || amount < 1)) return setError('Укажите количество награды');
    if (target === 'one' && !recipient.trim()) return setError('Укажите ID получателя');
    setError(null);
    const who = target === 'one' ? `игроку ${recipient.trim()}` : target === 'all' ? 'ВСЕМ игрокам' : 'всем активным игрокам за неделю';
    const rewardLabel = reward ? `${RESOURCES.find((r) => r.key === reward)?.label} x${amount}` : 'без награды';
    confirm(`Отправить письмо «${subject.trim()}» ${who} (${rewardLabel})`, async () => {
      const r = await adminCall<{ sent: number }>('mail', {
        subject, body, target, recipient,
        payload: reward ? payloadFor(reward, amount) : {},
      });
      setSubject('');
      setBody('');
      setQty('');
      setReward('');
      return `Письмо отправлено: ${r.sent} получателей`;
    });
  };

  return (
    <Panel title="Новое письмо" icon={<Mail className="w-4 h-4" />}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="block text-xs text-slate-400 mb-1">Тема письма</span>
          <input className={inputCls} maxLength={80} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="С праздником!" />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-400 mb-1">Текст сообщения</span>
          <textarea
            className={`${inputCls} h-32 py-2.5 resize-none`}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Дорогие герои! Поздравляем вас..."
          />
          <span className="block text-right text-[10px] text-slate-500 mt-0.5">{body.length}/1000</span>
        </label>
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Предмет / валюта</span>
            <select className={inputCls} value={reward} onChange={(e) => setReward(e.target.value)}>
              <option value="">Без награды</option>
              {RESOURCES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Количество</span>
            <input className={inputCls} type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} disabled={!reward} placeholder="0" />
          </label>
        </div>

        <fieldset>
          <legend className="text-xs text-slate-400 mb-1.5">Кому отправить</legend>
          <div className="space-y-1.5">
            {TARGETS.map((t) => (
              <label key={t.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${target === t.id ? 'border-sky-500/60 bg-sky-500/10' : 'border-slate-700/60 bg-slate-950/50'}`}>
                <input type="radio" name="target" checked={target === t.id} onChange={() => setTarget(t.id)} className="w-4 h-4 accent-sky-500" />
                <span>
                  <span className="block text-sm font-semibold text-slate-100">{t.label}</span>
                  <span className="block text-[11px] text-slate-400">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {target === 'one' && (
            <input className={`${inputCls} mt-2`} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Telegram ID или @username" />
          )}
        </fieldset>

        <ErrorLine text={error} />
        <button className="w-full h-12 rounded-xl bg-gradient-to-b from-sky-500 to-sky-700 text-sm font-bold text-white hover:brightness-110 flex items-center justify-center gap-2 transition">
          <Send className="w-4 h-4" /> Отправить письмо
        </button>
        <p className="text-[11px] text-slate-500 text-center">Игроки увидят письмо во внутриигровой почте с кнопкой «Забрать награду».</p>
      </form>
    </Panel>
  );
}
