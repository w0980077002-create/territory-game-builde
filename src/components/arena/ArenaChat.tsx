import { useEffect, useRef, useState } from 'react';
import { Send, MessageCircle } from 'lucide-react';
import { sendArenaChat, type ArenaMessage } from '@/game/arenaApi';

const KIND_STYLE: Record<ArenaMessage['kind'], string> = {
  system: 'text-amber-300 font-semibold',
  join: 'text-gray-500 italic',
  leave: 'text-gray-500 italic',
  hit: 'text-gray-300',
  crit: 'text-orange-400 font-semibold',
  block: 'text-sky-300/80',
  dodge: 'text-cyan-300/90 italic',
  kill: 'text-red-400 font-semibold',
  timeout: 'text-red-300 italic',
  item: 'text-sky-300',
  revive: 'text-rose-300 font-semibold',
  chat: 'text-white',
};

export function ArenaChat({ roomId, messages, myName }: { roomId: string; messages: ArenaMessage[]; myName: string }) {
  const [filter, setFilter] = useState<'all' | 'chat'>('all');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const shown = filter === 'chat' ? messages.filter((m) => m.kind === 'chat') : messages;

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendArenaChat(roomId, value);
      setText('');
      stick.current = true;
    } catch (err) {
      setError((err as Error).message);
    }
    setSending(false);
  };

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Лог боя и чат</h3>
        <div className="flex bg-black/30 rounded-lg p-0.5 text-[11px]">
          {(['all', 'chat'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2 py-0.5 rounded-md transition-colors ${filter === f ? 'bg-white/10 text-white' : 'text-gray-500'}`}>
              {f === 'all' ? 'Всё' : 'Только чат'}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-56 overflow-y-auto scrollbar-hide space-y-1 bg-black/20 rounded-xl p-2.5"
      >
        {shown.length === 0 && <p className="text-xs text-gray-600 italic">Пока тихо...</p>}
        {shown.map((m) => (
          <p key={m.id} className={`text-[13px] leading-snug break-words ${KIND_STYLE[m.kind] ?? 'text-gray-300'}`}>
            <span className="text-[10px] text-gray-600 mr-1.5 tabular-nums">
              {new Date(m.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            {m.kind === 'chat' && (
              <span className={`font-semibold mr-1 ${m.author === myName ? 'text-teal-300' : 'text-amber-200'}`}>{m.author}:</span>
            )}
            {m.body}
          </p>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 mt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Написать в чат..."
          className="flex-1 min-w-0 rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 transition-colors"
        />
        <button type="submit" disabled={!text.trim() || sending} className="btn-primary px-3 py-2" aria-label="Отправить">
          <Send className="w-4 h-4" />
        </button>
      </form>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}
