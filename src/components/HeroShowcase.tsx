import { Coins, Gem, Zap, Heart, Sword, Shield, Star, ChevronRight, Shirt, Hammer, ScrollText, UsersRound } from 'lucide-react';
import { EQUIPMENT_SLOTS, HERO_MAX_LEVEL, generateChapter, getComputedStats } from '@/game/engine';
import { getAppearanceIcon } from '@/game/appearance';
import { SLOT_ART, equipmentArt } from '@/game/art';
import { rarityColor } from '@/game/ui';
import { findHeroGearOpportunity } from '@/game/heroGearOpportunity';
import { useLanguage } from '@/game/i18n';
import { selectedFollower, FOLLOWER_TEMPLATES } from '@/game/followers';
import { getFollowerArt } from '@/game/combatArt';
import type { Equipment, GameState } from '@/game/types';
import './profileHero.css';

type HeroStats = ReturnType<typeof getComputedStats>;

interface Props {
  state: GameState;
  stats: HeroStats;
  onEquipment: () => void;
  onAdventure: () => void;
  onForge: (equipmentId: string) => void;
  onQuests: () => void;
  onCompanions: () => void;
}

/** Presentation only: all values and equipment are taken from the saved game state.
 * No grants, XP updates or inventory mutations happen in this component. */
export function HeroShowcase({ state, stats, onEquipment, onAdventure, onForge, onQuests, onCompanions }: Props) {
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
  const nextEnemy = bossReady ? chapter.boss : (chapter.enemies[chapterWins] ?? chapter.boss);
  // Only suggest gear that is already in the player's saved inventory and
  // would fill an empty real slot. This is navigation, not proof of ownership
  // for server combat or an automatic equip/grant.
  const readyGear = findHeroGearOpportunity(state.inventory, player.equipped);
  const readyQuest = state.quests.some(quest => !quest.claimed && quest.current >= quest.target);
  const forgeCandidate = Object.values(player.equipped).find((item): item is Equipment => !!item && item.level < player.level);
  const activeCompanion = selectedFollower(state);
  const activeCompanionTemplate = FOLLOWER_TEMPLATES.find(unit => unit.id === activeCompanion?.id);
  const text = (ru: string, en: string) => language === 'en' ? en : ru;

  const renderSlot = ({ slot, item }: { slot: (typeof EQUIPMENT_SLOTS)[number]; item: Equipment | undefined }) => (
    <button
      key={slot.id}
      type="button"
      onClick={onEquipment}
      className={'hero-showcase__slot ' + (item ? 'hero-showcase__slot--equipped' : 'hero-showcase__slot--empty')}
      style={item ? { borderColor: rarityColor(item.rarity), color: rarityColor(item.rarity) } : undefined}
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

      <div className="hero-showcase__stage" style={{ backgroundImage: `linear-gradient(180deg, #173c5120, #4c321d40), url("${import.meta.env.BASE_URL}assets/territory/scenes/sunlit-harbor.webp")` }}>
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

      <section className="hero-showcase__companion" data-testid="hero-companion-journey"
        aria-label={text('Спутник героя', 'Hero companion')}>
        <img src={activeCompanion ? getFollowerArt(activeCompanion.id)
          : import.meta.env.BASE_URL + 'assets/territory/map/icons/companions-v1.webp'}
          alt="" loading="lazy" draggable={false}/>
        <div className="hero-showcase__companion-copy">
          <span>{text('ПОМОЩНИК В ПОХОДЕ', 'CAMPAIGN COMPANION')}</span>
          <strong>{activeCompanion
            ? (language === 'en' ? (activeCompanionTemplate?.nameEn ?? activeCompanion.name) : activeCompanion.name)
            : text('Спутник ещё не открыт', 'No companion unlocked yet')}</strong>
          <small>{activeCompanion
            ? text(`Ур. ${activeCompanion.level} · Атака ${activeCompanion.attack} · Защита ${activeCompanion.defense}`,
                `Lv. ${activeCompanion.level} · Attack ${activeCompanion.attack} · Defense ${activeCompanion.defense}`)
            : text('Первый спутник откроется на 3 уровне', 'First companion unlocks at hero level 3')}</small>
          <small>{text('Помогает в Походе и Испытаниях, не на Арене', 'Helps in Campaign and Trials, not Arena')}</small>
        </div>
        <button type="button" onClick={onCompanions} data-testid="hero-open-companions">
          <UsersRound size={16} aria-hidden="true"/>{text('Лагерь', 'Camp')}<ChevronRight size={15} aria-hidden="true"/>
        </button>
      </section>

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
            src={import.meta.env.BASE_URL + (nextEnemy.art.startsWith('/') ? nextEnemy.art.slice(1) : nextEnemy.art)}
            alt="" loading="lazy" draggable={false} />
          <div className="hero-showcase__next-copy">
            <strong>{bossReady
              ? text('Босс готов к бою!', 'Boss battle unlocked!')
              : text('Следующий противник', 'Next opponent')}</strong>
            <span>{language === 'en'
              ? `Chapter ${chapterNumber} · ${chapterWins}/${chapter.winsNeeded} fights`
              : `${chapter.title} · ${chapterWins}/${chapter.winsNeeded} побед`}</span>
            <span className="text-[11px] font-bold text-amber-100">{nextEnemy.name} · HP {nextEnemy.maxHp} · ⚔ {nextEnemy.attack} · 🛡 {nextEnemy.defense}</span>
            <div className="hero-showcase__chapter-track" role="progressbar"
              aria-label={text('Победы до босса главы', 'Chapter victories before boss')}
              aria-valuemin={0} aria-valuemax={chapter.winsNeeded} aria-valuenow={chapterWins}>
              <span style={{ width: `${chapter.winsNeeded > 0 ? chapterWins / chapter.winsNeeded * 100 : 0}%` }} />
            </div>
          </div>
        </div>
        {(readyQuest || forgeCandidate) && (
          <div className="hero-showcase__preparation" aria-label={text('Подготовка к походу', 'Adventure preparation')} data-testid="hero-preparation-actions">
            {readyQuest && (
              <button type="button" onClick={onQuests} data-testid="hero-ready-quest">
                <ScrollText size={21} aria-hidden="true" />
                <span><strong>{text('Награда задания ждёт', 'Quest reward ready')}</strong>
                  <small>{text('Открыть настоящие задания', 'Open your quests')}</small></span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            )}
            {forgeCandidate && (
              <button type="button" onClick={() => onForge(forgeCandidate.id)} data-testid="hero-forge-gear">
                <img src={equipmentArt(forgeCandidate)} alt="" loading="lazy" draggable={false} />
                <span><strong>{text('Усилить снаряжение', 'Strengthen equipment')}</strong>
                  <small>{forgeCandidate.name} · {text('Посмотреть в кузнице', 'Inspect in forge')}</small></span>
                <Hammer size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {readyGear && (
          <button type="button" className="hero-showcase__loot" onClick={onEquipment}
            aria-label={text('Открыть экипировку: ', 'Open equipment: ') + readyGear.item.equipment.name}>
            <img src={equipmentArt(readyGear.item.equipment)} alt="" loading="lazy" draggable={false}
              style={{ borderColor: rarityColor(readyGear.item.equipment.rarity) }} />
            <span><strong>{readyGear.kind === 'upgrade'
              ? text('Есть усиление героя!', 'Stronger gear available!')
              : text('Добыча ждёт!', 'Gear ready!')}</strong>
              {readyGear.item.equipment.name}</span>
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
