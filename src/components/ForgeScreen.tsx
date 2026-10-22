import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { useLanguage, localizeText } from '@/game/i18n';
import { rarityColor, rarityGlow } from '@/game/ui';
import { Hammer, ArrowUp, X } from 'lucide-react';
import { hapticNotify } from '@/game/telegram';
import { SLOT_ART } from '@/game/art';
import { ItemArt } from './ui/ItemArt';
import { IosGamePortal } from './ui/Modal';
import type { Equipment, InventoryItem } from '@/game/types';
import { upgradeEquipment } from '@/game/equipmentBalance';
import { forgeAttempt, forgeCost, forgeSetBonus, forgeSuccessRate } from '@/game/forge';
import { EQUIPMENT_SLOTS } from '@/game/engine';

export function ForgeScreen() {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const equipment = state.inventory.filter((i) => i.type === 'equipment' && i.equipment);
  const equippedList = Object.values(state.player.equipped).filter(Boolean) as Equipment[];
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

  const lock = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);

  const tryUpgrade = (item: InventoryItem) => {
    if (lock.current || !item.equipment) return;
    // Validate against the freshest state; modal snapshots can become stale while
    // the shop, mail, daily rewards or auto-save change the player's resources.
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

    lock.current = true; // synchronous guard against two taps before React render
    setUpgrading(true);
    setError(null);
    pending.current = setTimeout(() => {
      const outcome: { status: ReturnType<typeof forgeAttempt>['status'] } = { status: 'invalid' };
      useGame.set((latest) => {
        const attempt = forgeAttempt(latest, item.id, eq.level, Math.random());
        outcome.status = attempt.status;
        return attempt.next;
      });
      lock.current = false;
      pending.current = null;
      setUpgrading(false);
      if (outcome.status === 'success') {
        setSelected(null);
        setSuccess(true);
        hapticNotify('success');
        setTimeout(() => setSuccess(false), 2200);
      } else {
        setError(outcome.status === 'failed' ? t('upgradeFailed') : (language === 'en' ? 'Equipment or resources changed. Please try again.' : 'Экипировка или ресурсы изменились. Попробуй ещё раз.'));
        hapticNotify('error');
        setSelected(null);
      }
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

  return (
    <div className="space-y-4 animate-fade-in pb-4">
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

      {/* Equipped items */}
      {equippedList.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('equippedGear')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {equippedList.map((eq) => (
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
                <div className="w-12 h-12 rounded-lg bg-black/30 flex items-center justify-center text-2xl mb-1"
                  style={{ boxShadow: rarityGlow(eq.rarity) }}
                >
                  <img src={SLOT_ART[eq.slot]} alt="" className="w-11 h-11 object-contain drop-shadow-[0_3px_4px_rgba(0,0,0,0.7)]" />
                </div>
                <p className="text-xs font-medium truncate w-full text-center" style={{ color: rarityColor(eq.rarity) }}>
                  {localizeText(eq.name, language)}
                </p>
                <p className="text-xs text-gray-500">{t('level')} {eq.level}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Inventory equipment */}
      {equipment.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('inInventory')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {equipment.map((item) => (
              <button
                key={item.id}
                className="card flex flex-col items-center p-3 transition-all active:scale-95 hover:border-orange-500/30"
                style={{ border: `1px solid ${rarityColor(item.rarity)}40` }}
                onClick={() => setSelected(item)}
              >
                <div className="w-12 h-12 rounded-lg bg-black/30 flex items-center justify-center text-2xl mb-1"
                  style={{ boxShadow: rarityGlow(item.rarity) }}
                >
                  <ItemArt item={item} size={44} />
                </div>
                <p className="text-xs font-medium truncate w-full text-center" style={{ color: rarityColor(item.rarity) }}>
                  {localizeText(item.name, language)}
                </p>
                <p className="text-xs text-gray-500">{t('level')} {item.equipment?.level || 1}</p>
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

      {/* Upgrade modal */}
      {selectedCurrent && selectedCurrent.equipment && (
        <IosGamePortal>
        <div
          className="forge-upgrade-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => { if (!upgrading) setSelected(null); }}
        >
          <div
            className="forge-upgrade-panel card w-full max-w-sm m-2 animate-slide-up"
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
                <h3 className="font-bold text-base" style={{ color: rarityColor(selectedCurrent.rarity) }}>
                  {localizeText(selectedCurrent.name, language)}
                </h3>
                <p className="text-xs text-gray-400">{t('level')} {selectedCurrent.equipment.level} · {selectedCurrent.rarity}</p>
              </div>
              <button onClick={() => { if (!upgrading) setSelected(null); }} className="text-gray-500 hover:text-white">
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
              </div>
            )}

            </div>
            <div className="forge-upgrade-actions">
            <button
              className="btn-accent w-full"
              onClick={() => tryUpgrade(selectedCurrent)}
              disabled={upgrading || selectedCurrent.equipment.level >= state.player.level}
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
