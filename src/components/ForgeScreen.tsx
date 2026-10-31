import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { saveCloudSave } from '@/game/cloud';
import { supabase } from '@/game/supabase';
import { useLanguage, localizeText } from '@/game/i18n';
import { rarityColor, rarityGlow } from '@/game/ui';
import { Hammer, ArrowUp, X, Package, MapPinned, CheckCircle2, Sword } from 'lucide-react';
import { hapticNotify } from '@/game/telegram';
import { equipmentArt } from '@/game/art';
import { ItemArt } from './ui/ItemArt';
import { ForgeForecastHint } from './ForgeForecastHint';
import { IosGamePortal } from './ui/Modal';
import type { Equipment, InventoryItem } from '@/game/types';
import { upgradeEquipment } from '@/game/equipmentBalance';
import { forgeAttempt, forgeCost, forgeSetBonus, forgeSuccessRate } from '@/game/forge';
import { EQUIPMENT_SLOTS } from '@/game/engine';
import { forgeMaterialTimeLeftLabel } from '@/game/elixirExpiry';

// Do not let navigating away and back bypass an unresolved forge confirmation.
// A fresh Telegram launch loads the canonical server save before restoring upgrades.
const unverifiedForgeUsers = new Set<string>();

export function ForgeScreen({ focusEquipmentId, onInventory, onMap, onBattle, userId }: { focusEquipmentId?: string | null; onInventory?: () => void; onMap?: () => void; onBattle?: () => void; userId: string }) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    const refresh = () => setNow(Date.now());
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A forge result is not final until the server has persisted it.
  const [saveUnverified, setSaveUnverified] = useState(() => unverifiedForgeUsers.has(userId));
  const [gearFilter, setGearFilter] = useState<'all' | 'ready' | 'equipped'>('all');
  const focused = useRef(false);

  const equipment = state.inventory.filter((i) => i.type === 'equipment' && i.equipment);
  const equippedList = Object.values(state.player.equipped).filter(Boolean) as Equipment[];
  useEffect(()=>{
    if (!focusEquipmentId || focused.current) return;
    focused.current=true;
    const latest=useGame.get();
    const worn=Object.values(latest.player.equipped).find((eq)=>eq?.id===focusEquipmentId);
    const bag=latest.inventory.find((item)=>item.equipment?.id===focusEquipmentId);
    if (worn) setSelected({id:`equipped_${worn.id}`,name:worn.name,icon:worn.icon,type:'equipment',rarity:worn.rarity,qty:1,description:'',equipment:worn});
    else if (bag) setSelected(bag);
  },[focusEquipmentId]);
  // Keep the open item panel linked to live equipment; owner updates arrive while
  // the modal is open, and a stale useState snapshot used to hide the new stats.
  const chosenId = selected?.equipment?.id;
  const freshEquipment = chosenId
    ? equippedList.find((eq) => eq.id === chosenId)
      ?? equipment.find((item) => item.equipment?.id === chosenId)?.equipment
    : null;
  const selectedCurrent = selected && freshEquipment
    ? { ...selected, equipment: freshEquipment }
    : null;
  const forgeDialogRef = useRef<HTMLDivElement>(null);
  const forgeCloseRef = useRef<HTMLButtonElement>(null);
  const dialogVisible = !!selectedCurrent?.equipment;
  useEffect(() => {
    if (!dialogVisible) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    forgeCloseRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [dialogVisible]);

  const lock = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);

  const tryUpgrade = (item: InventoryItem) => {
    if (lock.current || saveUnverified || !item.equipment) return;
    // The same item, currency, and material snapshot must be checked again at the
    // instant of the roll; the open modal can be stale after another game action.
    const now = useGame.get();
    const eq = item.equipment;
    if (eq.level >= now.player.level) {
      setError(t('upgradeMaxLevel'));
      hapticNotify('error');
      return;
    }
    const cost = forgeCost(eq.level);
    if (now.player.gold < cost.gold) { setError(t('notEnoughGold')); hapticNotify('error'); return; }
    if (now.forgeMaterials < cost.materials) { setError(t('notEnoughForgeMaterials')); hapticNotify('error'); return; }

    lock.current = true;
    setUpgrading(true);
    setError(null);
    pending.current = setTimeout(() => {
      pending.current = null;
      void (async () => {
        let changed: ReturnType<typeof forgeAttempt> | null = null;
        useGame.set((latest) => {
          changed = forgeAttempt(latest, item.id, eq.level, Math.random());
          return changed.next;
        });
        const result = changed as ReturnType<typeof forgeAttempt> | null;
        if (!result || result.status === 'invalid') {
          setError(language === 'en' ? 'Equipment or resources changed. Try again.' : 'Экипировка или ресурсы изменились. Попробуй ещё раз.');
          hapticNotify('error');
          setSelected(null);
          return;
        }
        try {
          // Autosave and this confirmation use the same coalescing CAS writer.
          // Do not show a green success or permit another roll on an uncommitted level.
          const saved = await saveCloudSave(userId, result.next);
          if (!saved) throw new Error('forge_cloud_save_failed');
          // A successful PATCH can be normalized by SQL triggers. Verify the
          // canonical item level and charged resources, not just the HTTP response.
          const { data, error: readError } = await supabase.from('players')
            .select('game_state,gold,forge_materials')
            .eq('id', userId).maybeSingle();
          if (readError || !data?.game_state) throw new Error('forge_save_unverified');
          const canonical = data.game_state as typeof result.next;
          const originalId = eq.id;
          const expectedLevel = result.status === 'success' ? eq.level + 1 : eq.level;
          const savedItem = item.id.startsWith('equipped_')
            ? Object.values(canonical.player.equipped).find((e) => e?.id === originalId)
            : canonical.inventory.find((e) => e.id === item.id)?.equipment;
          if (savedItem?.level !== expectedLevel
            || data.gold !== result.next.player.gold
            || data.forge_materials !== result.next.forgeMaterials) {
            throw new Error('forge_save_not_committed');
          }
          setSelected(null);
          if (result.status === 'success') {
            setSuccess(true);
            hapticNotify('success');
            setTimeout(() => setSuccess(false), 2200);
          } else {
            setError(t('upgradeFailed'));
            hapticNotify('error');
          }
        } catch (cause) {
          // Keep the local snapshot intact: never overwrite newer server awards
          // with an old copy. The player must reload before another forge roll.
          console.warn('Forge result not verified on the server:', cause);
          unverifiedForgeUsers.add(userId);
          setSaveUnverified(true);
          setSelected(null);
          setError(language === 'en'
            ? 'Forge result was not confirmed on the server. Reopen TERRITORY in Telegram before upgrading again. Do not repeat this roll.'
            : 'Результат заточки не подтверждён сервером. Перезапусти TERRITORY через Telegram перед следующей заточкой. Не повторяй попытку.');
          hapticNotify('error');
        }
      })().finally(() => { lock.current = false; setUpgrading(false); });
    }, 1000);
  };

  const setBonus = forgeSetBonus(state.player.equipped);

  const allEquipment = [
    ...equippedList.map((eq) => ({
      id: `equipped_${eq.id}`,
      name: eq.name,
      icon: eq.icon,
      type: 'equipment' as const,
      rarity: eq.rarity,
      qty: 1,
      description: `${language === 'en' ? 'Equipped · Level' : 'Надето · Уровень'} ${eq.level} · ${eq.rarity}`,
      equipment: eq,
    })),
    ...equipment,
  ];
  const forgeReady = (item: InventoryItem) => {
    if (!item.equipment || item.equipment.level>=state.player.level) return false;
    const cost=forgeCost(item.equipment.level);
    return state.player.gold>=cost.gold && state.forgeMaterials>=cost.materials;
  };
  const readyCount = allEquipment.filter(forgeReady).length;
  const listed = allEquipment.filter((item) => gearFilter === 'all' || (gearFilter === 'ready' ? forgeReady(item) : item.id.startsWith('equipped_')));
  const listedWorn = listed.filter((item) => item.id.startsWith('equipped_'));
  const listedBag = listed.filter((item) => !item.id.startsWith('equipped_'));

  return (
    <div className="viking-screen viking-screen--forge space-y-4 animate-fade-in pb-4">
      <div className="card text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Hammer className="w-6 h-6 text-orange-400" />
          <h2 className="text-xl font-bold text-white">{t('forgeTitle')}</h2>
        </div>
        <p className="text-sm text-gray-400">{language === 'en' ? 'Upgrade gear using gold and materials' : 'Улучшай экипировку за золото и материалы'}</p>
        <div className="flex justify-center gap-4 mt-3 text-sm">
          <span className="text-amber-400">🪙 {state.player.gold}</span>
          <span className="text-orange-400">🔩 {state.forgeMaterials}</span>
        </div>
        {state.forgeMaterials > 0 && <p className="mt-1 text-[11px] tabular-nums text-amber-300">⏳ {language === 'en' ? 'Materials expire in' : 'До истечения материалов'}: {forgeMaterialTimeLeftLabel(state, language, now)}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2 text-emerald-200">
            <CheckCircle2 className="mr-1 inline h-4 w-4" />{language === 'en' ? 'Ready to upgrade' : 'Готово к улучшению'}: <b>{readyCount}</b>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-amber-200">
            {language === 'en' ? 'Gear in workshop' : 'Вещей в кузнице'}: <b>{allEquipment.length}</b>
          </div>
        </div>
        {(onInventory || onMap || onBattle) && <div className="mt-2 grid grid-cols-3 gap-1.5" data-testid="forge-journey-navigation">
          {onInventory && <button type="button" onClick={onInventory} className="rounded-lg border border-violet-400/25 bg-violet-500/15 px-2 py-2 text-xs font-bold text-violet-100"><Package className="mr-1 inline h-4 w-4" />{language === 'en' ? 'Equipment' : 'Инвентарь'}</button>}
          {onMap && <button type="button" onClick={onMap} className="min-h-11 rounded-lg border border-sky-400/25 bg-sky-500/15 px-1 py-2 text-[11px] font-bold text-sky-100"><MapPinned className="mr-1 inline h-4 w-4" />{language === 'en' ? 'Gather' : 'Добыча'}</button>}
          {onBattle && <button type="button" onClick={onBattle} disabled={upgrading || saveUnverified}
            className="min-h-11 rounded-lg border border-amber-300/70 bg-gradient-to-b from-amber-500/40 to-amber-900/40 px-1 py-2 text-[11px] font-black text-amber-100 disabled:opacity-40">
            <Sword className="mr-1 inline h-4 w-4" />{language === 'en' ? 'Adventure' : 'В поход'}
          </button>}
        </div>}
      </div>

      {/* Full set rewards apply only in PvE; never inflate Arena stats. */}
      <div className="card border-amber-500/25 bg-gradient-to-br from-amber-950/30 to-slate-950/50">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="font-bold text-amber-200 text-sm">{language === 'en' ? 'Forged set' : 'Комплект кузнеца'}</p>
          <p className="font-bold text-amber-300 text-sm">{setBonus.slots}/7</p>
        </div>
        <div className="grid grid-cols-7 gap-1.5 mb-2">
          {EQUIPMENT_SLOTS.map(({ id, icon, name }) => {
            const forged = !!state.player.equipped[id] && (state.player.equipped[id]?.upgradeCount ?? 0) > 0;
            return <div key={id} title={name} className={`rounded-lg text-center py-2 text-lg border ${forged ? 'border-amber-400/70 bg-amber-500/25' : 'border-white/10 bg-black/20 opacity-45'}`}>{icon}</div>;
          })}
        </div>
        <p className="text-xs text-gray-300 leading-relaxed">
          {language === 'en'
            ? 'Upgrade different EQUIPPED slots: 3/7 +2% HP · 5/7 +3% defense · 7/7 +4% attack in PvE only.'
            : 'Улучшай РАЗНЫЕ надетые предметы: 3/7 +2% HP · 5/7 +3% защиты · 7/7 +4% атаки только в PvE.'}
        </p>
        <p className="text-[10px] text-amber-300/80 mt-1">{language === 'en' ? 'Arena stats do not change.' : 'Характеристики на Арене не меняются.'}</p>
      </div>

      {error && (
        <div className="card text-center text-red-400 text-sm animate-pop">
          {error}
        </div>
      )}

      {success && (
        <div className="card text-center text-teal-400 text-sm animate-pop">
          {language === 'en' ? 'Upgrade successful! The item is now stronger.' : 'Улучшение успешно! Предмет стал сильнее!'}
        </div>
      )}

      {allEquipment.length > 0 && <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label={language === 'en' ? 'Forge equipment filters' : 'Фильтры кузницы'}>
        {(['all', 'ready', 'equipped'] as const).map((filter) => <button type="button" key={filter} aria-pressed={gearFilter === filter} onClick={() => setGearFilter(filter)} className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-bold ${gearFilter === filter ? 'border-amber-400/70 bg-amber-400/20 text-amber-100' : 'border-white/10 bg-black/20 text-slate-300'}`}>
          {filter === 'all' ? (language === 'en' ? 'All items' : 'Все вещи') : filter === 'ready' ? (language === 'en' ? `Ready (${readyCount})` : `Можно улучшить (${readyCount})`) : (language === 'en' ? 'Equipped' : 'Надето')}
        </button>)}
      </div>}

      {/* Equipped items */}
      {listedWorn.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('equippedGear')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {listedWorn.map((item) => {
              const eq = item.equipment!;
              return (
              <button
                key={eq.id}
                className="card flex flex-col items-center p-3 transition-all active:scale-95 hover:border-orange-500/30"
                style={{ border: `1px solid ${rarityColor(eq.rarity)}40` }}
                onClick={() => setSelected({
                  id: `equipped_${eq.id}`,
                  name: eq.name,
                  icon: eq.icon,
                  type: 'equipment',
                  rarity: eq.rarity,
                  qty: 1,
                  description: `${language === 'en' ? 'Equipped · Level' : 'Надето · Уровень'} ${eq.level}`,
                  equipment: eq,
                })}
              >
                <div className="w-20 h-20 rounded-lg bg-black/30 flex items-center justify-center text-2xl mb-1"
                  style={{ boxShadow: rarityGlow(eq.rarity) }}
                >
                  <img src={equipmentArt(eq)} alt="" className="w-[72px] h-[72px] object-contain drop-shadow-[0_3px_4px_rgba(0,0,0,0.7)]" />
                </div>
                <p className="text-sm font-bold break-words w-full text-center" style={{ color: rarityColor(eq.rarity) }}>
                  {localizeText(eq.name, language)}
                </p>
                <p className="text-xs text-gray-500">{t('level')} {eq.level}</p>
                <p className={`mt-1 text-[10px] ${forgeReady(item) ? 'text-emerald-300' : 'text-amber-300/70'}`}>{forgeReady(item) ? (language === 'en' ? 'Ready to upgrade' : 'Можно улучшить') : (language === 'en' ? 'Not ready' : 'Пока недоступно')}</p>
              </button>
            );})}
          </div>
        </div>
      )}

      {/* Inventory equipment */}
      {listedBag.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('inInventory')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {listedBag.map((item) => (
              <button
                key={item.id}
                className="card flex flex-col items-center p-3 transition-all active:scale-95 hover:border-orange-500/30"
                style={{ border: `1px solid ${rarityColor(item.rarity)}40` }}
                onClick={() => setSelected(item)}
              >
                <div className="w-20 h-20 rounded-lg bg-black/30 flex items-center justify-center text-2xl mb-1"
                  style={{ boxShadow: rarityGlow(item.rarity) }}
                >
                  <ItemArt item={item} size={72} />
                </div>
                <p className="text-sm font-bold break-words w-full text-center" style={{ color: rarityColor(item.rarity) }}>
                  {localizeText(item.name, language)}
                </p>
                <p className="text-xs text-gray-500">{t('level')} {item.equipment?.level || 1}</p>
                <p className={`mt-1 text-[10px] ${forgeReady(item) ? 'text-emerald-300' : 'text-amber-300/70'}`}>{forgeReady(item) ? (language === 'en' ? 'Ready to upgrade' : 'Можно улучшить') : (language === 'en' ? 'Not ready' : 'Пока недоступно')}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {allEquipment.length === 0 && (
        <div className="card text-center py-8 text-gray-500">
          <Hammer className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t('noUpgradeGear')}</p>
          <p className="text-xs mt-1">{t('bossesHint')}</p>
        </div>
      )}
      {allEquipment.length > 0 && listed.length === 0 && <div className="card text-center py-5 text-sm text-amber-200">
        {language === 'en' ? 'No gear matches this filter. Check materials, gold and hero level.' : 'По фильтру ничего нет. Проверь материалы, монеты и уровень героя.'}
      </div>}

      {/* Upgrade modal */}
      {selectedCurrent && selectedCurrent.equipment && (
        <IosGamePortal>
        <div
          className="forge-upgrade-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => { if (!upgrading) setSelected(null); }}
        >
          <div
            ref={forgeDialogRef} className="forge-upgrade-panel card w-full max-w-sm m-2 animate-slide-up"
            role="dialog" aria-modal="true" aria-label={localizeText(selectedCurrent.name, language)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !upgrading) { event.stopPropagation(); setSelected(null); return; }
              if (event.key !== 'Tab' || !forgeDialogRef.current) return;
              const buttons = Array.from(forgeDialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              if (!buttons.length) { event.preventDefault(); return; }
              const first = buttons[0], last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }}
            style={{ border: `1px solid ${rarityColor(selectedCurrent.rarity)}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div
                className="w-14 h-14 rounded-xl bg-black/30 flex items-center justify-center text-3xl shrink-0"
                style={{ border: `1px solid ${rarityColor(selectedCurrent.rarity)}` }}
              >
                <ItemArt item={selectedCurrent} size={48} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-base">
                  {localizeText(selectedCurrent.name, language)}
                </h3>
                <p className="text-xs text-gray-400">{t('level')} {selectedCurrent.equipment.level} · {selectedCurrent.rarity}</p>
              </div>
              <button ref={forgeCloseRef} type="button" disabled={upgrading} aria-label={language === 'en' ? 'Close' : 'Закрыть'} onClick={() => { if (!upgrading) setSelected(null); }} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="forge-upgrade-scroll">
            {/* Current stats */}
            <div className="space-y-1 mb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider">{t('current')}</p>
              {selectedCurrent.equipment.attack ? <StatRow label={t('attack')} value={selectedCurrent.equipment.attack} /> : null}
              {selectedCurrent.equipment.defense ? <StatRow label={t('defense')} value={selectedCurrent.equipment.defense} /> : null}
              {selectedCurrent.equipment.hp ? <StatRow label={t('health')} value={selectedCurrent.equipment.hp} /> : null}
            </div>

            {/* Exact deterministic preview from current item template. */}
            {selectedCurrent.equipment.level < state.player.level && (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3 mb-3">
                <p className="text-xs font-semibold text-emerald-300 mb-2">{language === 'en' ? 'Next level (if successful)' : 'Следующий уровень (при успехе)'}</p>
                {(['attack', 'defense', 'hp', 'critChance'] as const).map((key) => {
                  const current = selectedCurrent.equipment?.[key] ?? 0;
                  const next = upgradeEquipment(selectedCurrent.equipment!)[key] ?? 0;
                  if (current <= 0 && next <= 0) return null;
                  const label = key === 'attack' ? t('attack') : key === 'defense' ? t('defense') : key === 'hp' ? t('health') : t('critChance');
                  return <div key={key} className="flex justify-between text-xs py-0.5"><span className="text-gray-300">{label}</span><span className="text-emerald-200">{current} → {next}{key === 'critChance' ? '%' : ''}</span></div>;
                })}
              </div>
            )}

            {/* Upgrade cost */}
            {selectedCurrent.equipment.level >= state.player.level ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 text-center">
                <p className="text-sm text-red-300 font-medium">
                  {t('upgradeMaxLevel')}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {language === 'en' ? 'Level up your hero to upgrade this item further.' : 'Повысьте уровень персонажа, чтобы улучшить предмет дальше'}
                </p>
              </div>
            ) : (
              <div className="bg-black/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('upgradeCost')}</p>
                <div className="flex justify-between text-sm">
                  <span className="text-amber-400">🪙 {forgeCost(selectedCurrent.equipment.level).gold}</span>
                  <span className="text-orange-400">🔩 {forgeCost(selectedCurrent.equipment.level).materials}</span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {language === 'en' ? 'Success chance' : 'Шанс успеха'}: {Math.round(forgeSuccessRate(selectedCurrent.equipment.level) * 100)}%
                </p>
                <ForgeForecastHint itemLevel={selectedCurrent.equipment.level} heroLevel={state.player.level} language={language}/>
              </div>
            )}

            </div>
            <div className="forge-upgrade-actions">
            <button
              className="btn-accent w-full"
              onClick={() => tryUpgrade(selectedCurrent)}
              disabled={upgrading || saveUnverified || selectedCurrent.equipment.level >= state.player.level}
            >
              {upgrading ? t('blacksmithWorking') : selectedCurrent.equipment.level >= state.player.level ? (
                t('maxLevel')
              ) : (
                <><ArrowUp className="w-4 h-4 inline mr-1" /> {t('upgrade')}</>
              )}
            </button>
            </div>
          </div>
        </div>
        </IosGamePortal>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}
