import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/game/supabase';
import catalog from '@/game/config/territory-independent-rune-slots-v1.json';
import {
  RUNE_SCHEMA, parseRuneServerStatus, runeSlotCatalog, validateRuneSlots,
  type RuneServerStatus, type RuneSlot,
} from '@/game/builds/runeSlotsV1';

// The real ledger exists only in staged SQL. Do not expose an editable book
// until server-issued ownership, production battle effects (PvE + tactical
// Arena), admin grants, safe cutover and mobile acceptance have all passed.
const FIFTEEN_SLOT_CONTRACT_READY = false;
const definitions = runeSlotCatalog(catalog);
type PendingSave = { operationId: string; revision: number; slots: RuneSlot[] };

export function ServerRuneBook({ language }: { language: 'ru' | 'en' }) {
  const en = language === 'en';
  const alive = useRef(false);
  const saving = useRef(false);
  const pending = useRef<PendingSave | null>(null);
  const [status, setStatus] = useState<RuneServerStatus | null>(null);
  const [draft, setDraft] = useState<RuneSlot[]>([]);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    alive.current = true;
    if (!FIFTEEN_SLOT_CONTRACT_READY) return () => { alive.current = false; };
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('territory_runes_status_v1');
        if (error) throw error;
        const verified = parseRuneServerStatus(data, definitions);
        if (!cancelled && alive.current) {
          setStatus(verified);
          setDraft(verified.slots.map(slot => ({ ...slot })));
          setNotice('');
        }
      } catch {
        if (!cancelled && alive.current) {
          setStatus(null);
          setNotice(en
            ? 'The server could not verify your runes. Your existing build was not changed.'
            : 'Сервер не подтвердил руны. Сохранённая сборка не изменена.');
        }
      }
    })();
    return () => { cancelled = true; alive.current = false; };
  }, [refresh, en]);

  const choose = (slotId: string, runeId: string | null) => {
    if (!status || saving.current || pending.current) return;
    if (runeId !== null && !status.owned[runeId]) return;
    setDraft(current => current.map(slot => slot.slotId === slotId ? { ...slot, runeId } : slot));
  };

  const save = async () => {
    if (!status || saving.current) return;
    let command = pending.current;
    if (!command) {
      try {
        const verified = validateRuneSlots(
          { schema: RUNE_SCHEMA, revision: status.revision, slots: draft },
          definitions, status.owned, status.revision,
        );
        if (JSON.stringify(verified.slots) === JSON.stringify(status.slots)) return;
        command = {
          operationId: crypto.randomUUID(),
          revision: status.revision,
          slots: verified.slots.map(slot => ({ ...slot })),
        };
        pending.current = command;
      } catch {
        setNotice(en ? 'Invalid or unavailable rune. No changes saved.' : 'Руна недоступна или выбор неверен. Изменения не сохранены.');
        return;
      }
    }
    saving.current = true;
    setNotice(en ? 'Saving 15 slots on the server…' : 'Сохраняем 15 слотов на сервере…');
    try {
      const { data, error } = await supabase.rpc('territory_runes_save_v1', {
        p_operation: command.operationId,
        p_revision: command.revision,
        p_slots: command.slots,
      });
      if (error) throw error;
      // A receipt is not a client grant: verify it matches the submitted
      // operation before claiming success, then re-read the server status.
      // PostgreSQL jsonb may reorder object keys; compare slot fields rather
      // than serialized JSON so a valid server receipt is not rejected.
      const receiptSlots: unknown = data?.slots;
      const matchesSlots = Array.isArray(receiptSlots)
        && receiptSlots.length === command.slots.length
        && receiptSlots.every((slot: unknown, index: number) => {
          if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) return false;
          const value = slot as Record<string, unknown>;
          return value.slotId === command.slots[index].slotId
            && value.runeId === command.slots[index].runeId;
        });
      if (!data || data.schema !== RUNE_SCHEMA
        || data.operationId !== command.operationId
        || data.revision !== command.revision + 1
        || !matchesSlots) {
        throw Error('rune_receipt_mismatch');
      }
      pending.current = null;
      if (alive.current) {
        setNotice(en ? 'Server confirmed your 15-slot build.' : 'Сервер подтвердил сборку из 15 слотов.');
        setRefresh(value => value + 1);
      }
    } catch (error) {
      if (alive.current) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('rune_revision_conflict') || message.includes('rune_not_owned')) {
          pending.current = null;
          setNotice(en ? 'The build changed on the server. Reload before saving.' : 'Сборка на сервере изменилась. Обнови её перед сохранением.');
        } else {
          // A lost response may mean the transaction committed. Keep the
          // exact UUID/revision/slots for an idempotent retry, not a new grant.
          setNotice(en ? 'No confirmation. Retry the same operation; do not choose new runes yet.'
            : 'Нет подтверждения. Повтори ту же операцию, пока не меняй руны.');
        }
      }
    } finally {
      saving.current = false;
    }
  };

  if (!FIFTEEN_SLOT_CONTRACT_READY) {
    return <p role="status" className="rounded-lg border border-amber-500/40 bg-slate-900/90 p-3 text-xs text-amber-100">
      {en ? 'The 15-slot rune system is not available yet. Existing hero training remains unchanged.'
        : 'Система из 15 слотов рун пока недоступна. Существующая тренировка героя сохранена.'}
    </p>;
  }

  if (!status) return <div role="status" className="rounded-xl border border-amber-500/40 bg-slate-900 p-3 text-amber-100">
    <p>{notice || (en ? 'Checking server-owned runes…' : 'Проверяем руны на сервере…')}</p>
    <button type="button" onClick={() => setRefresh(value => value + 1)}
      className="mt-2 min-h-11 rounded-lg border border-amber-300 px-3 font-bold">
      {en ? 'Retry' : 'Повторить'}
    </button>
  </div>;

  const changed = JSON.stringify(draft) !== JSON.stringify(status.slots);
  return <section aria-label={en ? 'Fifteen rune slots' : 'Пятнадцать слотов рун'} className="space-y-3">
    <div className="rounded-xl border border-amber-300/50 bg-[#302017] p-3 text-xs text-amber-100">
      <p className="font-black text-amber-200">{en ? 'Rune book · 15 independent slots' : 'Книга рун · 15 независимых слотов'}</p>
      <p className="mt-1">{en ? 'Only server-owned runes can be selected. No rune is a combat skill slot.'
        : 'Можно выбрать только подтверждённые сервером руны. Слоты рун не заменяют боевые навыки.'}</p>
    </div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {catalog.slots.map((slot, index) => {
        const selected = draft[index]?.runeId ?? null;
        return <section key={slot.slotId} className="rounded-xl border border-amber-500/40 bg-[#261b19]/95 p-2.5">
          <h3 className="mb-2 text-sm font-black text-amber-200">{en ? slot.nameEn : slot.nameRu}</h3>
          <button type="button" aria-pressed={selected === null} disabled={saving.current || !!pending.current}
            onClick={() => choose(slot.slotId, null)}
            className="mb-1.5 min-h-10 w-full rounded-lg border border-amber-200/30 px-2 text-left text-xs text-amber-100 disabled:opacity-50">
            {en ? 'No rune' : 'Без руны'} {selected === null ? '✓' : ''}
          </button>
          {slot.options.map(option => {
            const level = status.owned[option.runeId] ?? 0;
            const active = selected === option.runeId;
            return <button type="button" key={option.runeId} aria-pressed={active}
              disabled={!level || saving.current || !!pending.current}
              onClick={() => choose(slot.slotId, option.runeId)}
              className={`mb-1.5 min-h-12 w-full rounded-lg border px-2 py-1.5 text-left text-xs disabled:opacity-45 ${active
                ? 'border-amber-200 bg-amber-700/45 text-white'
                : 'border-amber-500/25 bg-black/30 text-amber-100'}`}>
              <span className="block font-extrabold">{en ? option.nameEn : option.nameRu} {active ? '✓' : ''}</span>
              <span className="block text-[11px]">{en ? option.effectEn : option.effectRu}</span>
              <span className="block text-[10px] font-bold text-sky-200">{level
                ? (en ? `Owned · level ${level}` : `Получена · уровень ${level}`)
                : (en ? 'Locked' : 'Не получена')}</span>
            </button>;
          })}
        </section>;
      })}
    </div>
    {notice && <p role="status" className="rounded-lg border border-amber-400/40 bg-slate-900 p-2 text-xs text-amber-100">{notice}</p>}
    <button type="button" onClick={() => void save()}
      disabled={saving.current || (!changed && !pending.current)}
      className="min-h-12 w-full rounded-xl border border-amber-200 bg-gradient-to-b from-amber-300 to-amber-600 px-3 font-black text-[#29180b] disabled:opacity-50">
      {pending.current ? (en ? 'Retry same save' : 'Повторить сохранение')
        : (en ? 'Save 15 slots' : 'Сохранить 15 слотов')}
    </button>
  </section>;
}
