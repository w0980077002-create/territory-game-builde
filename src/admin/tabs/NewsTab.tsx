import { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Italic, Underline, Quote, Send, RefreshCw, Newspaper } from 'lucide-react';
import { getAdminToken } from '@/admin/api';
import { ErrorLine, Panel, type Confirm } from '@/admin/ui';

const ENDPOINT = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/territory-news';
const INITIAL_POST = [
  '🔥⚔️ **МОРТАРИОН ПРОБУДИЛСЯ!**', '',
  '💀 **ВЛАСТЕЛИН ДУШ** бросает вызов героям ТЕРРИТОРИИ!', '',
  '❤️ **100 000 000 HP**', '⏳ **5 СУТОК НА ПОБЕДУ**',
  '⚔️ 5 ударов в час, перерыв 60 секунд',
  '🏆 **ТОП-10** по нанесённому урону', '',
  '🎁 **НАГРАДЫ:** сундуки, редкие материалы, Сердце Мортариона и шанс получить Камень пробуждения!',
  '', '> ⚡ Чем активнее сражаешься, тем ценнее твоя награда!', '',
  '🏰 **ГОРОД → МОРТАРИОН**', '',
  '🔥 **ОБЪЕДИНЯЕМ СИЛЫ И УНИЧТОЖАЕМ БОССА!**',
].join('\n');

type Status = { configured: boolean; ready: boolean; channel: string };
type Receipt = { ok: boolean; channel: string; messageId: number | null };

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inline(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>');
}
function previewHtml(raw: string): string {
  const output: string[] = [];
  let quotes: string[] = [];
  const flush = () => {
    if (quotes.length) output.push('<blockquote class="border-l-4 border-amber-500 bg-amber-100/10 pl-3 py-2 my-2 rounded-r">' + quotes.join('\n') + '</blockquote>');
    quotes = [];
  };
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('> ')) quotes.push(inline(line.slice(2)));
    else { flush(); output.push(inline(line)); }
  }
  flush();
  return output.join('\n');
}

async function newsCall<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const token = getAdminToken();
  if (!token) throw new Error('Войди в админку заново.');
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + import.meta.env.VITE_SUPABASE_ANON_KEY,
      Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, token, ...extra }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) {
    const reason = String(result?.error ?? '');
    if (reason === 'bot_token_not_configured') throw new Error('В серверных секретах не найден токен Telegram-бота.');
    if (reason === 'city_time_reference_not_allowed') throw new Error('Убери географическую привязку: игра международная.');
    if (reason === 'admin_session_required') throw new Error('Сессия администратора истекла. Войди повторно.');
    if (reason === 'telegram_post_failed_check_bot_admin_rights') throw new Error('Бот не смог опубликовать. Проверь его права администратора канала.');
    throw new Error('Сервер новостей пока недоступен (' + (reason || response.status) + ').');
  }
  return result as T;
}

export function NewsTab({ confirm }: { confirm: Confirm }) {
  const [message, setMessage] = useState(INITIAL_POST);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => previewHtml(message), [message]);

  const refreshStatus = async () => {
    setChecking(true);
    setError(null);
    try { setStatus(await newsCall<Status>('status')); }
    catch (e) { setError((e as Error).message); setStatus(null); }
    finally { setChecking(false); }
  };
  useEffect(() => { void refreshStatus(); }, []);

  const surround = (left: string, right: string, fallback: string) => {
    const el = editor.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = message.slice(start, end) || fallback;
    setMessage(message.slice(0, start) + left + selected + right + message.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + left.length, start + left.length + selected.length);
    });
  };

  const ready = status?.ready === true;
  const invalidLocation = /киев|київ|kiev|kyiv/iu.test(message);
  const canPublish = ready && message.trim().length >= 10 && message.length <= 3500 && !invalidLocation;

  const publish = () => {
    if (!canPublish) return;
    const exactMessage = message;
    confirm('Опубликовать оформленный пост в @TerritoryNews? Это увидят подписчики канала.', async () => {
      const receipt = await newsCall<Receipt>('publish', { message: exactMessage, confirm: true });
      if (!receipt.ok) throw new Error('Публикация не подтверждена.');
      return 'Пост опубликован в @TerritoryNews, ID ' + String(receipt.messageId ?? '—');
    });
  };

  return (
    <div className="space-y-4">
      <Panel title="TerritoryNews · редактор публикаций" icon={<Newspaper className="w-5 h-5" />}>
        <p className="mb-3 text-xs leading-relaxed text-slate-400">
          Настоящее оформление Telegram: жирный, курсив, подчёркивание, цитаты.
          Публикация напрямую через бота — копировать текст не нужно.
        </p>
        <div className="mb-3 flex items-center gap-2">
          <span className={'text-xs font-semibold ' + (ready ? 'text-emerald-400' : 'text-amber-300')}>
            {ready ? '● Бот готов к публикации' : status?.configured ? '● Боту нужны права на публикацию' : '● Бот не подключён'}
          </span>
          <button type="button" onClick={() => void refreshStatus()} disabled={checking}
            className="ml-auto flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs">
            <RefreshCw size={13} /> Проверить
          </button>
        </div>
        <ErrorLine text={error} />
        <label htmlFor="territory-news-editor" className="mb-1 block text-xs font-semibold text-slate-300">Текст новости</label>
        <textarea id="territory-news-editor" ref={editor} value={message}
          onChange={e => setMessage(e.target.value)} rows={13}
          className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-sm leading-relaxed text-slate-100 outline-none focus:border-amber-500" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border border-slate-600 px-3 py-2 text-xs" onClick={() => surround('**', '**', 'жирный текст')}>
            <Bold size={15} className="inline" /> Жирный
          </button>
          <button type="button" className="rounded-lg border border-slate-600 px-3 py-2 text-xs" onClick={() => surround('*', '*', 'курсив')}>
            <Italic size={15} className="inline" /> Курсив
          </button>
          <button type="button" className="rounded-lg border border-slate-600 px-3 py-2 text-xs" onClick={() => surround('__', '__', 'подчёркнутый')}>
            <Underline size={15} className="inline" /> Линия
          </button>
          <button type="button" className="rounded-lg border border-slate-600 px-3 py-2 text-xs" onClick={() => surround('\n> ', '', 'важная мысль')}>
            <Quote size={15} className="inline" /> Цитата
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Игра международная: никаких привязок к отдельным городам. {message.length}/3500 символов.
        </p>
        {invalidLocation && <p className="mt-2 text-xs text-red-300">Убери название города из текста.</p>}
        <button type="button" disabled={!canPublish} onClick={publish}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-400 to-orange-600 px-4 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
          <Send size={18} /> ОПУБЛИКОВАТЬ В TERRITORYNEWS
        </button>
      </Panel>
      <Panel title="Как пост увидят подписчики">
        <div className="whitespace-pre-wrap break-words rounded-2xl bg-[#e6f2fa] p-4 text-[15px] leading-relaxed text-slate-900 shadow-lg"
          dangerouslySetInnerHTML={{ __html: html }} />
        <p className="mt-2 text-xs text-slate-500">
          Предпросмотр. После подтверждения бот отправляет сообщение в формате Telegram HTML.
        </p>
      </Panel>
    </div>
  );
}
