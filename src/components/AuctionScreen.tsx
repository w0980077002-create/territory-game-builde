import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { MessageCircle, Send, ShoppingBag, Package, Radio, AlertCircle } from 'lucide-react';
import { supabase } from '@/game/supabase';
import { useGame } from '@/game/actions';
import { useLanguage } from '@/game/i18n';
import { useStore } from '@/game/store';
import { fetchAuctionOverview, submitAuctionAction, type AuctionAction, type AuctionOverview } from '@/game/auctionApi';

type AuctionTab = 'lots' | 'mine' | 'chat';
interface ChatMessage {
  id: string;
  author: string;
  text: string;
  at: number;
}

const CHAT_TOPIC = 'territory-auction-lobby';

export function AuctionScreen() {
  const game = useStore(useGame);
  const { t, language } = useLanguage();
  const [tab, setTab] = useState<AuctionTab>('lots');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [auction, setAuction] = useState<AuctionOverview | null>(null);
  const [auctionLoading, setAuctionLoading] = useState(true);
  const [auctionError, setAuctionError] = useState('');
  const [tradeBusy, setTradeBusy] = useState(false);
  const [askPrice, setAskPrice] = useState('100');
  const [pendingOperation, setPendingOperation] = useState<{ action: AuctionAction; id: string } | null>(null);

  const refreshAuction = async () => {
    const latest = await fetchAuctionOverview();
    setAuction(latest);
    return latest;
  };

  useEffect(() => {
    let alive = true;
    void fetchAuctionOverview().then((latest) => {
      if (alive) { setAuction(latest); setAuctionError(''); }
    }).catch(() => { if (alive) setAuctionError(language === 'en' ? 'Market unavailable.' : 'Аукцион временно недоступен.');
    }).finally(() => { if (alive) setAuctionLoading(false); });
    return () => { alive = false; };
  }, []);

  const trade = async (action: AuctionAction, pending?: { action: AuctionAction; id: string }) => {
    if (tradeBusy || !auction?.enabled) return;
    if (pendingOperation && !pending) return; // Never abandon an uncertain operation.
    const op = pending || { action, id: crypto.randomUUID() };
    setTradeBusy(true);
    setAuctionError('');
    try {
      await submitAuctionAction(op.action, op.id);
      setPendingOperation(null);
      await refreshAuction();
    } catch {
      // The network may have timed out AFTER a committed transaction.
      // Keep the SAME operation UUID for a safe retry, don't double-charge.
      setPendingOperation(op);
      setAuctionError(language === 'en'
        ? 'Result unconfirmed. Retry the same operation; do not make another trade.'
        : 'Результат операции не подтверждён. Повтори её с тем же номером, не создавай новую.');
    } finally { setTradeBusy(false); }
  };

  const ru = language !== 'en';
  const formatGold = (n: number) => n.toLocaleString(ru ? 'ru-RU' : 'en-US');


  useEffect(() => {
    let mounted = true;
    const channel = supabase.channel(CHAT_TOPIC, { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel.on('broadcast', { event: 'chat-message' }, ({ payload }) => {
      const incoming = payload as Partial<ChatMessage> | null;
      if (!incoming || typeof incoming.id !== 'string' || typeof incoming.author !== 'string' ||
          typeof incoming.text !== 'string' || typeof incoming.at !== 'number') return;
      const message: ChatMessage = {
        id: incoming.id.slice(0, 80),
        author: incoming.author.slice(0, 24),
        text: incoming.text.slice(0, 200),
        at: incoming.at,
      };
      setMessages((current) => current.some((item) => item.id === message.id)
        ? current
        : [...current, message].slice(-100));
    });
    channel.subscribe((status) => {
      if (!mounted) return;
      if (status === 'SUBSCRIBED') {
        setConnected(true);
        setChatError('');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnected(false);
        setChatError(t('auctionErrorConnect'));
      } else if (status === 'CLOSED') {
        setConnected(false);
      }
    });
    return () => {
      mounted = false;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, tab]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim().slice(0, 200);
    if (!text || sending) return;
    const channel = channelRef.current;
    if (!channel || !connected) {
      setChatError(t('auctionChatNotConnected'));
      return;
    }
    setSending(true);
    setChatError('');
    const message: ChatMessage = {
      id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 9),
      author: (game.player.name || (language === 'en' ? 'Hero' : 'Герой')).slice(0, 24),
      text,
      at: Date.now(),
    };
    try {
      const result = await channel.send({ type: 'broadcast', event: 'chat-message', payload: message });
      if (result !== 'ok') throw new Error(t('sendFailed'));
      setMessages((current) => [...current, message].slice(-100));
      setDraft('');
    } catch (error) {
      setChatError(error instanceof Error ? error.message : t('sendError'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3 pb-5 text-white">
      <section className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-[#282116] to-[#111820] p-4">
        <div className="flex items-center gap-3">
          <ShoppingBag className="h-7 w-7 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black">{t('auctionHouse')}</h2>
            <p className="text-xs text-slate-300">{t('playerMarketChat')}</p>
          </div>
          <span className={connected ? 'rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300' : 'rounded-full bg-slate-700/50 px-2 py-1 text-[10px] font-bold text-slate-400'}>
            {connected ? t('chatOnline') : t('connecting')}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-1.5">
        {([
          ['lots', t('allLots')],
          ['mine', t('myLots')],
          ['chat', language === 'en' ? 'Chat' : 'Чат'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={tab === id ? 'rounded-xl border border-amber-400 bg-amber-500/20 px-1 py-3 text-xs font-bold text-amber-100' : 'rounded-xl border border-white/10 bg-white/5 px-1 py-3 text-xs font-bold text-slate-300'}>
            {label}
          </button>
        ))}
      </div>

      {(tab === 'lots' || tab === 'mine') && (
        <section className="rounded-xl border border-sky-400/20 bg-sky-500/5 p-4">
          <div className="flex items-center gap-2">
            {tab === 'mine' ? <Package className="h-5 w-5 text-sky-300" /> : <ShoppingBag className="h-5 w-5 text-amber-300" />}
            <h3 className="font-bold">{tab === 'mine' ? t('myListedItems') : t('playerLots')}</h3>
          </div>
          {!auction?.enabled ? (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-semibold text-slate-100">{auctionLoading ? t('connecting') : t('tradingDisabled')}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">{t('noFakeLots')}</p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-xs text-emerald-300">{ru ? 'Подтверждённые сервером предметы · ' : 'Server-verified items · '}{ru ? 'Золото' : 'Gold'}: {auction.myGold === null ? '—' : formatGold(auction.myGold)}</p>
              <div className="mt-3 space-y-2">
                {(tab === 'mine' ? auction.mine : auction.lots).map((lot) => (
                  <div key={lot.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-amber-100">{lot.item.icon || '📦'} {lot.item.name || (ru ? 'Предмет' : 'Item')}</div>
                        <p className="text-[10px] text-slate-400">{lot.item.rarity || '—'} {'seller' in lot ? ` · ${lot.seller}` : ''}</p>
                      </div>
                      <span className="shrink-0 text-sm font-black text-amber-300">{formatGold(lot.price_gold)} 🪙</span>
                    </div>
                    {tab === 'mine' ? (
                      <button disabled={tradeBusy || !!pendingOperation} onClick={() => void trade({ action: 'cancel', listingId: lot.id })}
                        className="mt-2 w-full rounded-lg border border-rose-500/40 py-2 text-xs text-rose-200 disabled:opacity-40">{ru ? 'Снять с продажи' : 'Cancel listing'}</button>
                    ) : !auction.mine.some((mine) => mine.id === lot.id) && (
                      <button disabled={tradeBusy || !!pendingOperation || auction.myGold === null || auction.myGold < lot.price_gold}
                        onClick={() => void trade({ action: 'buy', listingId: lot.id })}
                        className="mt-2 w-full rounded-lg bg-amber-600 py-2 text-xs font-bold disabled:opacity-40">{ru ? 'Купить' : 'Buy'}</button>
                    )}
                  </div>
                ))}
                {(tab === 'mine' ? auction.mine : auction.lots).length === 0 && (
                  <p className="text-xs text-slate-400">{ru ? 'Пока нет доступных лотов.' : 'No listings yet.'}</p>
                )}
              </div>
              {tab === 'mine' && auction.items.length > 0 && (
                <div className="mt-3 rounded-xl border border-white/10 p-3">
                  <h4 className="text-sm font-bold">{ru ? 'Выставить предмет мастера' : 'List a crafted item'}</h4>
                  <label className="mb-2 mt-2 block text-xs text-slate-300">{ru ? 'Цена в золоте' : 'Price in gold'}
                    <input type="number" min="1" max="2147483647" step="1" inputMode="numeric" value={askPrice}
                      onChange={(event) => setAskPrice(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-white" />
                  </label>
                  {auction.items.map((item) => (
                    <button key={item.item_id} disabled={tradeBusy || !!pendingOperation || !Number.isSafeInteger(Number(askPrice)) || Number(askPrice) < 1 || Number(askPrice) > 2147483647}
                      onClick={() => void trade({ action: 'list', itemId: item.item_id, priceGold: Number(askPrice) })}
                      className="mb-1.5 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-100 disabled:opacity-40">
                      {item.item.icon || '📦'} {item.item.name || (ru ? 'Предмет' : 'Item')} · + {ru ? 'выставить' : 'list'}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-black/25 p-3"><b className="block text-lg text-amber-200">10%</b><span className="text-[10px] text-slate-400">{t('saleFee')}</span></div>
            <div className="rounded-lg bg-black/25 p-3"><b className="block text-lg text-amber-200">{auction?.enabled ? auction.lots.length : 0}</b><span className="text-[10px] text-slate-400">{ru ? 'Лоты' : 'Listings'}</span></div>
          </div>
          {auctionError && <p role="alert" className="mt-2 text-xs text-rose-300">{auctionError}</p>}
          {pendingOperation && (
            <button disabled={tradeBusy} onClick={() => void trade(pendingOperation.action, pendingOperation)}
              className="mt-2 w-full rounded-lg bg-amber-600 p-2.5 text-sm font-bold disabled:opacity-40">
              {ru ? 'Безопасно повторить операцию' : 'Retry same operation'}
            </button>
          )}
          {auction?.enabled && !pendingOperation && (
            <button disabled={tradeBusy} onClick={() => void refreshAuction().catch(() => setAuctionError(ru ? 'Ошибка обновления' : 'Refresh failed'))}
              className="mt-2 w-full rounded-lg border border-white/10 p-2 text-xs text-slate-300 disabled:opacity-40">{ru ? 'Обновить' : 'Refresh'}</button>
          )}
        </section>
      )}

      {tab === 'chat' && (
        <section className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-100"><MessageCircle className="h-4 w-4" /> {t('auctionChat')}</h3>
            <span className="flex items-center gap-1 text-[10px] text-slate-400"><Radio className="h-3 w-3" /> {connected ? t('online') : t('waitingNetwork')}</span>
          </div>
          <div ref={messagesRef} className="h-64 space-y-2 overflow-y-auto rounded-xl border border-white/5 bg-black/30 p-3">
            {messages.length === 0 && <p className="text-xs text-slate-500">{t('firstMessage')}</p>}
            {messages.map((message) => (
              <div key={message.id} className="break-words text-sm">
                <span className="mr-2 text-[10px] text-slate-500">{new Date(message.at).toLocaleTimeString(language === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                <b className={message.author === game.player.name ? 'text-emerald-300' : 'text-amber-200'}>{message.author}:</b>
                <span className="ml-1 text-slate-100">{message.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={sendMessage} className="mt-2 flex gap-2">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={200} placeholder={t('writeChat')}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-amber-400/50 focus:outline-none" />
            <button type="submit" aria-label={t('sendMessage')} disabled={!draft.trim() || sending || !connected}
              className="rounded-xl bg-amber-600 px-3 py-2.5 font-bold text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
          {chatError && <p role="alert" className="mt-2 text-xs text-red-300"><AlertCircle className="mr-1 inline h-3.5 w-3.5" />{chatError}</p>}
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{t('chatHistoryNotice')}</p>
        </section>
      )}
    </div>
  );
}
