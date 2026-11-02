import { useEffect, useRef, useState } from 'react';
import { Check, Crown, Flame, Heart, LockKeyhole, Shield, Snowflake, Sparkles, Swords, Target, Wind, X, Zap } from 'lucide-react';
import './serverRuneBook.css';
import { supabase } from '@/game/supabase';
import catalog from '@/game/config/territory-independent-rune-slots-v1.json';
import skillCatalog from '@/game/config/territory-rune-skill-book-v1.json';
import {
  RUNE_SCHEMA, parseRuneServerStatus, runeSlotCatalog, validateRuneSlots,
  type RuneServerStatus, type RuneSlot,
} from '@/game/builds/runeSlotsV1';
import { runeTacticalEquivalent } from '@/game/builds/runePveEffectsV1';

const bonusLabels: Record<string, { ru: string; en: string }> = {
  rune_combat_damage_bp: { ru: 'урону', en: 'damage' },
  rune_combat_guard_bp: { ru: 'защите', en: 'guard' },
  rune_combat_crit_bp: { ru: 'шансу крита', en: 'critical chance' },
  rune_combat_dodge_bp: { ru: 'уклонению', en: 'dodge chance' },
  rune_combat_accuracy_bp: { ru: 'точности', en: 'accuracy' },
};

// The real ledger exists only in staged SQL. Do not expose an editable book
// until server-issued ownership, production battle effects (PvE + tactical
// Arena), admin grants, safe cutover and mobile acceptance have all passed.
const FIFTEEN_SLOT_CONTRACT_READY = import.meta.env.VITE_TERRITORY_RUNES === 'enabled';
const definitions = runeSlotCatalog(catalog);
type PendingSave = { operationId: string; revision: number; slots: RuneSlot[] };

const RUNE_GROUPS = [
  { ru: 'База', en: 'Base', symbol: 'ᛉ' },
  { ru: 'Ядро', en: 'Core', symbol: 'ᚠ' },
  { ru: 'Контроль', en: 'Control', symbol: 'ᚦ' },
  { ru: 'Пробуждение', en: 'Awakening', symbol: 'ᛟ' },
  { ru: 'Финал', en: 'Final', symbol: 'ᛞ' },
];
const runeIcons = [Shield, Swords, Target, Snowflake, Crown, Zap, Wind, Flame, Sparkles, Heart];
const runeTones = ['ember', 'frost', 'forest', 'violet', 'gold'];
// Visual-only legacy archetypes. The 15 server slots remain independent:
// names and symbols do NOT add or imply skill effects, ownership or passive grants.
const runeArchetypes = skillCatalog.groups.flatMap(group => group.skills);
const archetypeById = new Map(runeArchetypes.map(skill => [skill.id, skill]));
const skillGlyphs = { shield: Shield, swords: Swords, target: Target, snowflake: Snowflake,
  crown: Crown, zap: Zap, wind: Wind, flame: Flame } as const;
function SkillSigil({ skillId }: { skillId: string }) {
  const archetype = archetypeById.get(skillId);
  const Icon = archetype ? (skillGlyphs[archetype.icon as keyof typeof skillGlyphs] ?? Sparkles) : Sparkles;
  const tone = archetype?.tone ?? 'gold';
  return <span aria-hidden="true" className={'territory-rune__stone territory-rune__stone--' + tone +
    ' territory-rune__skill-sigil'}><Icon size={29} strokeWidth={2.7}/></span>;
}
function RuneStone({ slotIndex, variant = 0, faded = false }: {
  slotIndex: number; variant?: number; faded?: boolean;
}) {
  const Icon = runeIcons[(slotIndex * 3 + variant) % runeIcons.length];
  return <span aria-hidden="true" className={'territory-rune__stone territory-rune__stone--' +
    runeTones[(slotIndex + variant) % runeTones.length] + (faded ? ' territory-rune__stone--faded' : '')}>
    <Icon size={24} strokeWidth={2.8}/>
  </span>;
}


export function ServerRuneBook({ language }: { language: 'ru' | 'en' }) {
  const en = language === 'en';
  // Changing the UI language must never refetch and overwrite an unsaved rune draft.
  const languageRef = useRef(language);
  languageRef.current = language;
  const alive = useRef(false);
  const saving = useRef(false);
  const pending = useRef<PendingSave | null>(null);
  const [status, setStatus] = useState<RuneServerStatus | null>(null);
  const [draft, setDraft] = useState<RuneSlot[]>([]);
  const [notice, setNotice] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [dailyReceipt, setDailyReceipt] = useState<{ dayUtc: string; runeId: string; level: number } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (activeSlot === null) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setActiveSlot(null); return; }
      if (event.key !== 'Tab') return;
      const dialog = document.getElementById('territory-rune-dialog');
      if (!dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); openerRef.current?.focus({ preventScroll: true }); };
  }, [activeSlot]);

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
          setNotice(languageRef.current === 'en'
            ? 'The server could not verify your runes. Your existing build was not changed.'
            : 'Сервер не подтвердил руны. Сохранённая сборка не изменена.');
        }
      }
    })();
    return () => { cancelled = true; alive.current = false; };
  }, [refresh]);

  // The daily grant refreshes server ownership and the saved loadout. Never
  // discard an unsaved 15-slot draft as a side effect of collecting it.
  const hasUnsavedDraft = () => !!status && JSON.stringify(draft) !== JSON.stringify(status.slots);
  const claimDaily = async () => {
    if (!status || claiming || saving.current || pending.current || hasUnsavedDraft()
      || dailyReceipt?.dayUtc === new Date().toISOString().slice(0, 10)) return;
    setClaiming(true);
    try {
      const { data, error } = await supabase.rpc('territory_runes_claim_daily_v1');
      if (error) throw error;
      if (!data || data.schema !== 'territory-rune-daily/1'
        || typeof data.dayUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dayUtc)
        || typeof data.runeId !== 'string' || !definitions.some(s => s.options.includes(data.runeId))
        || !Number.isSafeInteger(data.level) || data.level < 1 || data.level > 3) {
        throw Error('rune_daily_receipt_invalid');
      }
      setDailyReceipt({ dayUtc: data.dayUtc, runeId: data.runeId, level: data.level });
      setNotice(en
        ? `Daily rune received · level ${data.level}. Reloading collection…`
        : `Ежедневная руна получена · уровень ${data.level}. Обновляем коллекцию…`);
      setRefresh(value => value + 1);
    } catch {
      setNotice(en
        ? 'Daily rune could not be confirmed. You can safely try again.'
        : 'Не удалось подтвердить ежедневную руну. Можно безопасно повторить.');
    } finally {
      setClaiming(false);
    }
  };

  const choose = (slotId: string, runeId: string | null) => {
    if (!status || claiming || saving.current || pending.current) return;
    if (runeId !== null && !status.owned[runeId]) return;
    setDraft(current => current.map(slot => slot.slotId === slotId ? { ...slot, runeId } : slot));
  };

  const save = async () => {
    if (!status || claiming || saving.current) return;
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
      {en ? 'Runes are temporarily unavailable. Your saved build remains intact.'
        : 'Руны временно недоступны. Твоя сохранённая сборка не изменена.'}
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
  const claimedToday = dailyReceipt?.dayUtc === new Date().toISOString().slice(0, 10);
  const dailyRuneName = dailyReceipt
    ? catalog.slots.flatMap(slot => slot.options).find(option => option.runeId === dailyReceipt.runeId)
    : null;
  const equippedCount = draft.filter(slot => slot.runeId !== null).length;
  const ownedCount = Object.values(status.owned).filter(level => level > 0).length;
  const modalSlot = activeSlot === null ? null : catalog.slots[activeSlot];
  const draftSelection = activeSlot === null ? null : draft[activeSlot]?.runeId ?? null;
  const currentSave = activeSlot === null ? null : status.slots[activeSlot]?.runeId ?? null;
  const totalBonuses: Record<string, number> = {};
  draft.forEach(slot => {
    if (!slot.runeId) return;
    const fallback = runeTacticalEquivalent(slot.runeId, status.owned[slot.runeId] || 1);
    if (fallback) totalBonuses[fallback.key] = (totalBonuses[fallback.key] || 0) + fallback.bp;
  });

  return <section data-testid="territory-server-rune-book" className="territory-rune"
    aria-label={en ? 'Fifteen rune slots' : 'Пятнадцать слотов рун'}>
    <header className="territory-rune__header">
      <div className="territory-rune__crystal" aria-hidden="true"><Sparkles size={27}/></div>
      <h2>{en ? 'Runes of Power' : 'Руны навыков'}</h2>
      <p>{en ? '15 slots · 45 variants' : '15 слотов · 45 вариантов'}</p>
    </header>
    <div className="territory-rune__footer">
      <button type="button" onClick={() => void claimDaily()} data-testid="rune-daily-claim"
        disabled={claiming || saving.current || !!pending.current || claimedToday || changed} className="territory-rune__daily">
        <Sparkles size={19}/>
        {claiming ? (en ? 'Checking…' : 'Проверяем…') : claimedToday
          ? (en ? 'Rune received ✓' : 'Руна дня получена ✓') : changed
            ? (en ? 'Save build first' : 'Сначала сохрани сборку')
            : (en ? 'Claim daily rune' : 'Получить руну дня')}
      </button>
      <button type="button" onClick={() => void save()} data-testid="rune-save-build"
        disabled={claiming || saving.current || (!changed && !pending.current)} className="territory-rune__save">
        {pending.current ? (en ? 'Retry save' : 'Повторить запись')
          : changed ? (en ? 'Save build' : 'Сохранить сборку')
            : (en ? 'Build saved ✓' : 'Сборка сохранена ✓')}
      </button>
    </div>
    <div className="territory-rune__board">
      {RUNE_GROUPS.map((group, row) => <div key={group.en} className="territory-rune__row">
        <div className="territory-rune__group">
          <span className="territory-rune__glyph" aria-hidden="true">{[<Shield key="base" size={23}/>, <Flame key="core" size={23}/>, <Wind key="control" size={23}/>, <Sparkles key="awake" size={23}/>, <Crown key="final" size={23}/>][row]}</span>
          <strong>{en ? group.en : group.ru === 'Пробуждение' ? <>Пробуж<br/>дение</> : group.ru}</strong>
        </div>
        <div className="territory-rune__choices">
          {catalog.slots.slice(row * 3, row * 3 + 3).map((slot, col) => {
            const index = row * 3 + col;
            const chosen = draft[index]?.runeId;
            const synced = chosen === status.slots[index]?.runeId;
            const archetype = archetypeById.get(slot.legacySkillId);
            const hasOwned = slot.options.some(option => !!status.owned[option.runeId]);
            return <button key={slot.slotId} type="button" data-testid={'rune-slot-' + (index + 1)}
              className={'territory-rune__tile' + (chosen ? ' territory-rune__tile--equipped' : hasOwned ? ' territory-rune__tile--available' : ' territory-rune__tile--locked')}
              aria-label={(en ? 'Rune slot ' : 'Рунный слот ') + (index + 1) +
                (chosen ? (synced ? (en ? ', equipped' : ', установлена') : (en ? ', pending save' : ', ожидает сохранения')) : (hasOwned ? (en ? ', available' : ', доступны руны') : (en ? ', none owned' : ', нет полученных рун')))}
              aria-pressed={chosen !== null && chosen !== undefined}
              onClick={event => { openerRef.current = event.currentTarget; setActiveSlot(index); }}>
              <SkillSigil skillId={slot.legacySkillId}/>
              <small>{index + 1}</small>
              {chosen && synced && <span className="territory-rune__equipped"><Check size={11}/></span>}
              {!chosen && !hasOwned && <span className="territory-rune__locked" aria-hidden="true"><LockKeyhole size={12}/></span>}
              <span className="territory-rune__skill-name">{archetype ? (en ? archetype.nameEn : archetype.nameRu) : (en ? 'Rune' : 'Руна')}</span>
              {chosen ? <span className="territory-rune__tile-label">{synced ? (en ? 'Equipped' : 'Установлено') : (en ? 'Not saved' : 'Не сохранено')}</span>
                : <span className="territory-rune__tile-label">{hasOwned ? (en ? 'Select' : 'Выбрать') : (en ? 'Not owned' : 'Нет руны')}</span>}
            </button>;
          })}
        </div>
      </div>)}
    </div>
    <div className="territory-rune__passives">
      <strong>{en ? 'Rune collection' : 'Коллекция рун'}</strong>
      <div className="territory-rune__totals">
        <span><Sparkles size={17}/>{en ? 'Owned' : 'Получено'} <b>{ownedCount}/45</b></span>
        <span><Shield size={17}/>{en ? 'Equipped' : 'Установлено'} <b>{equippedCount}/15</b></span>
      </div>
      <div className="territory-rune__stats" aria-label={en ? 'Bonuses from selected runes' : 'Бонусы выбранных рун'}>
        <b>{en ? 'Build bonuses' : 'Бонусы сборки'}:</b>
        {Object.keys(totalBonuses).length === 0
          ? <span>{en ? 'Equip a rune to see its effects' : 'Установи руну, чтобы увидеть эффекты'}</span>
          : Object.entries(totalBonuses).map(([key, bp]) => <span key={key}>+
            {(bp / 100).toFixed(2).replace(/\.00$/, '')}% {en ? (bonusLabels[key]?.en ?? key) : (bonusLabels[key]?.ru ?? key)}</span>)}
      </div>
    </div>
    {dailyReceipt && dailyRuneName && <p role="status" data-testid="rune-daily-receipt"
      aria-live="polite" className="territory-rune__receipt">
      <Sparkles size={19}/>
      {en ? 'Received: ' : 'Получено: '}
      {en ? dailyRuneName.nameEn : dailyRuneName.nameRu} · {en ? 'level' : 'уровень'} {dailyReceipt.level}
    </p>}
    {notice && <p role="status" aria-live="polite" className="territory-rune__notice">{notice}</p>}
    {modalSlot && activeSlot !== null && <div className="territory-rune__veil"
      onMouseDown={event => { if (event.target === event.currentTarget) setActiveSlot(null); }}>
      <section id="territory-rune-dialog" role="dialog" aria-modal="true"
        aria-label={(en ? 'Rune slot ' : 'Рунный слот ') + (activeSlot + 1)}
        className="territory-rune__dialog">
        <div className="territory-rune__dialog-head">
          <strong>{en ? 'Rune details' : 'Подробности руны'} · {activeSlot + 1}</strong>
          <button ref={closeRef} type="button" onClick={() => setActiveSlot(null)}
            aria-label={en ? 'Close' : 'Закрыть'}><X size={22}/></button>
        </div>
        <div className="territory-rune__dialog-body">
          <h3>{(() => { const skill = archetypeById.get(modalSlot.legacySkillId); return skill ? (en ? skill.nameEn : skill.nameRu) : (en ? 'Choose a rune' : 'Выбери руну'); })()}</h3>
          <p className="territory-rune__help">{en ? 'Choose one of 3 independently equipped runes. Only server-owned runes can be used.'
            : 'Выбери одну из трёх независимых рун. Установить можно только полученную руну.'}</p>
          <div className="territory-rune__variants">
            {modalSlot.options.map((option, variant) => {
              const level = status.owned[option.runeId] ?? 0;
              const picked = draftSelection === option.runeId;
              const fallback = runeTacticalEquivalent(option.runeId, level || 1);
              const family = fallback && bonusLabels[fallback.key];
              return <button type="button" key={option.runeId} aria-pressed={picked}
                data-testid={'rune-option-' + variant} disabled={!level || claiming || saving.current || !!pending.current}
                className={'territory-rune__variant' + (picked ? ' territory-rune__variant--picked' : '')}
                onClick={() => choose(modalSlot.slotId, option.runeId)}>
                <RuneStone slotIndex={activeSlot} variant={variant} faded={!level}/>
                <strong>{en ? option.nameEn : option.nameRu}</strong>
                <span className="territory-rune__variant-effect">{en ? option.effectEn : option.effectRu}</span>
                {family && <small>{en ? 'All battles' : 'Во всех боях'}: +
                  {(fallback.bp / 100).toFixed(2).replace(/\.00$/, '')}% {en ? family.en : family.ru}</small>}
                <em>{picked ? (en ? '✓ Equipped' : '✓ Выбрана')
                  : level ? ((en ? 'Level ' : 'Уровень ') + level)
                    : (en ? 'Not owned' : 'Не получена')}</em>
              </button>;
            })}
          </div>
          <button type="button" className="territory-rune__unequip" aria-pressed={draftSelection === null}
            disabled={claiming || saving.current || !!pending.current} onClick={() => choose(modalSlot.slotId, null)}>
            {en ? 'Remove rune from slot' : 'Снять руну со слота'}
          </button>
          {draftSelection !== currentSave && <p role="status" className="territory-rune__draft">
            {en ? 'Your choice is not saved yet.' : 'Выбор ещё не сохранён на сервере.'}
          </p>}
        </div>
        <div className="territory-rune__dialog-actions">
          <button type="button" onClick={() => setActiveSlot(null)}
            className="territory-rune__cancel">{en ? 'Back' : 'Назад'}</button>
          <button type="button" onClick={() => void save()} disabled={claiming || saving.current || (!changed && !pending.current)}
            className="territory-rune__save">
            {en ? 'Save build' : 'Сохранить сборку'}
          </button>
        </div>
      </section>
    </div>}
  </section>;
}
