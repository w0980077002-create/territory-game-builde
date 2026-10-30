import { Coins, Gem, Zap, Heart, Sword, Shield, Star, ChevronRight, Shirt } from 'lucide-react';
import { EQUIPMENT_SLOTS, HERO_MAX_LEVEL, generateChapter, getComputedStats } from '@/game/engine';
import { getAppearanceIcon } from '@/game/appearance';
import { SLOT_ART, equipmentArt } from '@/game/art';
import { rarityColor } from '@/game/ui';
import { useLanguage } from '@/game/i18n';
import type { Equipment, GameState } from '@/game/types';
import './profileHero.css';

type HeroStats = ReturnType<typeof getComputedStats>;

interface Props {
  state: GameState;
  stats: HeroStats;
  onEquipment: () => void;
  onAdventure: () => void;
}

/** Presentation only: all values and equipment are taken from the saved game state.
 * No grants, XP updates or inventory mutations happen in this component. */
export function HeroShowcase({ state, stats, onEquipment, onAdventure }: Props) {
  const { t, language } = useLanguage();
  const player = state.player;
  const isMax = player.level >= HERO_MAX_LEVEL;
  const hasRealXp = Number.isFinite(player.xp) && Number.isFinite(player.xpToNext) && player.xpToNext > 0 && !isMax;
  const xp = hasRealXp ? Math.min(Math.max(0, player.xp), player.xpToNext) : 0;
  const xpPercent = hasRealXp ? Math.max(0, Math.min(100, 100 * xp / player.xpToNext)) : 0;
  const slots = EQUIPMENT_SLOTS.map(slot => ({ slot, item: player.equipped[slot.id] }));
  // Existing saved campaign progress: the chapter generator is also used by
  // the real PvE fight. No invented XP, boss counters or reward claims.
  const chapterNumber = Number.isFinite(state.currentChapter)
    ? Math.max(1, Math.floor(state.currentChapter)) : 1;
  const chapter = generateChapter(chapterNumber);
  const chapterWins = Number.isFinite(state.chapterWins)
    ? Math.max(0, Math.min(chapter.winsNeeded, Math.floor(state.chapterWins))) : 0;
  const bossReady = chapterWins >= chapter.winsNeeded;
  // Only suggest gear that is already in the player's saved inventory and
  // would fill an empty real slot. This is navigation, not proof of ownership
  // for server combat or an automatic equip/grant.
  const readyGear = state.inventory.find(item => item.type === 'equipment'
    && item.qty > 0 && item.equipment && !player.equipped[item.equipment.slot]);
  const text = (ru: string, en: string) => language === 'en' ? en : ru;

  const renderSlot = ({ slot, item }: { slot: (typeof EQUIPMENT_SLOTS)[number]; item: Equipment | undefined }) => (
    <button
      key={slot.id}
      type="button"
      onClick={onEquipment}
      className={'hero-showcase__slot ' + (item ? 'hero-showcase__slot--equipped' : 'hero-showcase__slot--empty')}
      style={item ? { borderColor: rarityColor(item.rarity) } : undefined}
      title={item ? item.name : slot.name}
      aria-label={item
        ? text('Экипировано: ', 'Equipped: ') + item.name + '. ' + text('Открыть экипировку', 'Open equipment')
        : slot.name + ': ' + text('пусто. Открыть экипировку', 'empty. Open equipment')}
    >
      <img src={item ? equipmentArt(item) : SLOT_ART[slot.id]} alt="" draggable={false} />
      {item && <span className="hero-showcase__item-level">{item.level}</span>}
    </button>
  );

  return (
    <section className="hero-showcase" aria-label={text('Герой и развитие', 'Hero and progression')} data-testid="living-hero-showcase">
      <header className="hero-showcase__header">
        <div className="hero-showcase__identity">
          <h2>{player.name}</h2>
          <span className="hero-showcase__level">{t('levelWord')} {player.level}</span>
        </div>
        <div className="hero-showcase__resources" aria-label={text('Ресурсы героя', 'Hero resources')}>
          <span><Coins size={15} aria-hidden="true" />{player.gold}</span>
          <span><Gem size={15} aria-hidden="true" />{player.gems}</span>
          <span><Zap size={15} aria-hidden="true" />{player.energy}/{player.maxEnergy}</span>
        </div>
        {hasRealXp ? (
          <div className="hero-showcase__xp">
            <div className="hero-showcase__xp-label">
              <span>XP</span>
              <span>{xp} / {player.xpToNext}</span>
            </div>
            <div className="hero-showcase__xp-track" role="progressbar"
              aria-label={text('Опыт до следующего уровня', 'Experience to next level')}
              aria-valuemin={0} aria-valuemax={player.xpToNext} aria-valuenow={xp}>
              <span style={{ width: xpPercent + '%' }} />
            </div>
          </div>
        ) : isMax ? (
          <p className="hero-showcase__max">{text('Максимальный уровень', 'Maximum level')}</p>
        ) : null}
      </header>

      <div className="hero-showcase__stage">
        <div className="hero-showcase__gear-column">{slots.slice(0, 3).map(renderSlot)}</div>
        <div className="hero-showcase__character">
          <img className="hero-showcase__hero-art" src={getAppearanceIcon(state.appearance)}
            alt={text('Герой в полный рост', 'Full-body hero')} draggable={false} />
          <div className="hero-showcase__character-floor" aria-hidden="true" />
        </div>
        <div className="hero-showcase__gear-column">{slots.slice(3).map(renderSlot)}</div>
      </div>

      <button type="button" className="hero-showcase__equipment-link" onClick={onEquipment}>
        <Shirt size={17} aria-hidden="true" />{text('Моя экипировка', 'My equipment')}<ChevronRight size={17} aria-hidden="true" />
      </button>

      <div className="hero-showcase__stats" aria-label={t('withEquipment')}>
        <h3 className="hero-showcase__plaque-title">{t('withEquipment')}</h3>
        <div className="hero-showcase__stat-grid">
          <div className="hero-showcase__stat"><Heart size={18} className="hero-showcase__heart" aria-hidden="true"/><span>{t('heroHealth')}<strong>{stats.maxHp}</strong></span></div>
          <div className="hero-showcase__stat"><Sword size={18} className="hero-showcase__attack" aria-hidden="true"/><span>{t('attack')}<strong>{stats.attack}</strong></span></div>
          <div className="hero-showcase__stat"><Shield size={18} className="hero-showcase__defense" aria-hidden="true"/><span>{t('defense')}<strong>{stats.defense}</strong></span></div>
          <div className="hero-showcase__stat"><Star size={18} className="hero-showcase__crit" aria-hidden="true"/><span>{t('critChance')}<strong>{stats.critChance}%</strong></span></div>
        </div>
      </div>

      <div className="hero-showcase__journey">
        <h3 className="hero-showcase__plaque-title">{t('battlePath')}</h3>
        <div className="hero-showcase__records">
          <div><strong>{state.totalBattlesWon}</strong><span>{t('wins')}</span></div>
          <div><strong>{state.totalBossesDefeated}</strong><span>{t('bosses')}</span></div>
          <div><strong>{chapterNumber}</strong><span>{t('chapter')}</span></div>
        </div>
        <div className="hero-showcase__next" data-testid="hero-next-goal">
          <img className="hero-showcase__boss-art"
            src={import.meta.env.BASE_URL + chapter.boss.art.replace(/^\\/+/, '')}
            alt="" loading="lazy" draggable={false} />
          <div className="hero-showcase__next-copy">
            <strong>{bossReady
              ? text('Босс готов к бою!', 'Boss battle unlocked!')
              : text('Путь к боссу', 'Road to the boss')}</strong>
            <span>{language === 'en'
              ? `Chapter ${chapterNumber} · ${chapterWins}/${chapter.winsNeeded} fights`
              : `${chapter.title} · ${chapterWins}/${chapter.winsNeeded} побед`}</span>
            <div className="hero-showcase__chapter-track" role="progressbar"
              aria-label={text('Победы до босса главы', 'Chapter victories before boss')}
              aria-valuemin={0} aria-valuemax={chapter.winsNeeded} aria-valuenow={chapterWins}>
              <span style={{ width: `${chapter.winsNeeded > 0 ? chapterWins / chapter.winsNeeded * 100 : 0}%` }} />
            </div>
          </div>
        </div>
        {readyGear?.equipment && (
          <button type="button" className="hero-showcase__loot" onClick={onEquipment}
            aria-label={text('Открыть экипировку: ', 'Open equipment: ') + readyGear.equipment.name}>
            <img src={equipmentArt(readyGear.equipment)} alt="" loading="lazy" draggable={false}
              style={{ borderColor: rarityColor(readyGear.equipment.rarity) }} />
            <span><strong>{text('Добыча ждёт!', 'Gear ready!')}</strong>
              {readyGear.equipment.name}</span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="hero-showcase__adventure" onClick={onAdventure}>
          {text('Продолжить поход', 'Continue adventure')}<ChevronRight size={19} aria-hidden="true"/>
        </button>
      </div>
    </section>
  );
}
