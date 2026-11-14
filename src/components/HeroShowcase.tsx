import { Coins, Gem, Zap, Heart, Sword, Swords, Shield, Star, ChevronRight, Shirt, Hammer, ScrollText, UsersRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { EQUIPMENT_SLOTS, HERO_MAX_LEVEL, generateChapter, getComputedStats } from '@/game/engine';
import { getAppearanceIcon } from '@/game/appearance';
import { SLOT_ART, equipmentArt } from '@/game/art';
import { rarityColor } from '@/game/ui';
import { findHeroGearOpportunity } from '@/game/heroGearOpportunity';
import { useLanguage, localizeRarity } from '@/game/i18n';
import { selectedFollower, DISPLAY_FOLLOWER_TEMPLATES, HALLOWEEN_COMPANION_ID, followerRarity, followerCombat } from '@/game/followers';
import { PumpkinWitch } from './PumpkinWitch';
import { getFollowerArt } from '@/game/combatArt';
import type { Equipment, GameState } from '@/game/types';
import './profileHero.css';
import { useSceneArt } from './ui/useSceneArt';

const HERO_HARBOR_ART = ['assets/territory/scenes/winter-peaks-approved.webp'] as const;

/** Handmade inset metalwork for the three *already existing* Mortarion honors.
 * This is decorative presentation only: actual award authority stays on server. */
const MORTARION_FRAME_ART: Record<string,string> = {
  mortarion_lord: 'assets/territory/ui/honors/mortarion-lord-stage.svg',
  mortarion_conqueror: 'assets/territory/ui/honors/mortarion-conqueror-stage.svg',
  mortarion_hunter: 'assets/territory/ui/honors/mortarion-hunter-stage.svg',
};

// Mirrors the LIVE Mortarion reward tier honors. QA selector is visual only:
// it does not change saved title, rank, reward receipt, or player statistics.
const MORTARION_TEST_HONORS = {
  top1: { title: 'Повелитель душ', frame: 'mortarion_lord', medal: 'Корона Мортариона' },
  top2: { title: 'Покоритель тьмы', frame: 'mortarion_conqueror', medal: 'Печать Покорителя' },
  top4: { title: 'Охотник на души', frame: 'mortarion_hunter', medal: 'Медаль Мортариона' },
} as const;
type MortarionPreviewRank = 'none' | keyof typeof MORTARION_TEST_HONORS;

type HeroStats = ReturnType<typeof getComputedStats>;

interface Props {
  state: GameState;
  stats: HeroStats;
  onEquipment: () => void;
  onAdventure: () => void;
  onForge: (equipmentId: string) => void;
  onQuests: () => void;
  onCompanions: () => void;
  vipEntry?: ReactNode;
}

/** Presentation only: all values and equipment are taken from the saved game state.
 * No grants, XP updates or inventory mutations happen in this component. */
export function HeroShowcase({ state, stats, onEquipment, onAdventure, onForge, onQuests, onCompanions, vipEntry }: Props) {
  const { t, language } = useLanguage();
  const player = state.player;
  const [mortarionPreviewRank, setMortarionPreviewRank] = useState<MortarionPreviewRank>('none');
  const canPreviewMortarion = state.mortarionOwnerTestChest?.testOnly === true;
  const previewHonor = canPreviewMortarion && mortarionPreviewRank !== 'none'
    ? MORTARION_TEST_HONORS[mortarionPreviewRank] : null;
  const displayedHonor = previewHonor ?? state.mortarionHonor;
  const frameArt = displayedHonor?.frame ? MORTARION_FRAME_ART[displayedHonor.frame] : undefined;

  const { status: harborStatus, retry: retryHarbor } = useSceneArt(HERO_HARBOR_ART);
  const harborReady = harborStatus === 'ready';
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
  // A failed asset must never show a browser's broken-image marker in the hero journey.
  const [enemyImageFailed, setEnemyImageFailed] = useState(false);
  useEffect(() => { setEnemyImageFailed(false); }, [nextEnemy.art]);
  // Only suggest gear that is already in the player's saved inventory and
  // would fill an empty real slot. This is navigation, not proof of ownership
  // for server combat or an automatic equip/grant.
  const readyGear = findHeroGearOpportunity(state.inventory, player.equipped);
  const readyQuest = state.quests.some(quest => !quest.claimed && quest.current >= quest.target);
  const forgeCandidate = Object.values(player.equipped).find((item): item is Equipment => !!item && item.level < player.level);
  const activeCompanion = selectedFollower(state);
  const activeCompanionTemplate = DISPLAY_FOLLOWER_TEMPLATES.find(unit => unit.id === activeCompanion?.id);
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
          {displayedHonor?.title && <span data-testid="mortarion-profile-title" className="hero-showcase__mortarion-title">{previewHonor ? 'ТЕСТ · ' : '♛ '}{displayedHonor.title}</span>}
          {displayedHonor?.medal && <span data-testid="mortarion-profile-medal" className="hero-showcase__mortarion-medal" title={displayedHonor.medal}>🏅 {displayedHonor.medal}</span>}
          <span className="hero-showcase__level">{t('levelWord')} {player.level}</span>
        </div>
        <div className="hero-showcase__resources" aria-label={text('Ресурсы героя', 'Hero resources')}>
          <span><Coins size={15} aria-hidden="true" />{player.gold}</span>
          <span><Gem size={15} aria-hidden="true" />{player.gems}</span>
          <span><Zap size={15} aria-hidden="true" />{player.energy}/{player.maxEnergy}</span>
        </div>
      </header>

      <div className="hero-showcase__banner" role="heading" aria-level={2}>
        <span aria-hidden="true">◆</span>{text('Герой','Hero')}<span aria-hidden="true">◆</span>
      </div>

      {canPreviewMortarion && <div data-testid="mortarion-owner-honor-preview"
        className="mx-1 my-2 rounded-lg border border-violet-400/50 bg-violet-950/40 p-2 text-center">
        <p className="mb-1 text-[10px] font-bold text-amber-200">{text('ТЕСТ · Титулы, рамки и медали Мортариона', 'TEST · Mortarion titles, frames and medals')}</p>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label={text('Выбрать пример награды', 'Select reward preview')}>
          {([['none',text('Обычный','Real')],['top1','ТОП-1'],['top2','ТОП-2–3'],['top4','ТОП-4–10']] as const).map(([id,label]) =>
            <button key={id} type="button" onClick={() => setMortarionPreviewRank(id)}
              aria-pressed={mortarionPreviewRank===id} data-testid={`mortarion-owner-preview-${id}`}
              className={`min-h-9 rounded-md border px-1 text-[10px] font-bold ${mortarionPreviewRank===id
                ? 'border-amber-300 bg-amber-700/60 text-white' : 'border-amber-600/40 bg-black/30 text-amber-100'}`}>{label}</button>
          )}
        </div>
      </div>}

      <div className={'hero-showcase__stage ' + (!harborReady ? 'hero-showcase__stage--art-pending' : '')
        + (frameArt ? ' hero-showcase__stage--' + displayedHonor?.frame : '')}
        aria-busy={harborStatus==='loading'}
        style={{ backgroundImage: harborReady
          ? `linear-gradient(180deg, #173c5120, #4c321d40), url("${import.meta.env.BASE_URL}assets/territory/scenes/winter-peaks-approved.webp")`
          : 'linear-gradient(160deg,#57402c,#292521 62%,#1d2630)' }}>
        <div className="hero-showcase__gear-column">{slots.slice(0, 3).map(renderSlot)}</div>
        <div className={'hero-showcase__character' +
          (displayedHonor?.frame ? ' hero-showcase__character--' + displayedHonor.frame : '')}>
          <img className="hero-showcase__hero-art" src={getAppearanceIcon(state.appearance)}
            alt={text('Герой в полный рост', 'Full-body hero')} draggable={false} />
          <div className="hero-showcase__character-floor" aria-hidden="true" />
        </div>
        <div className="hero-showcase__gear-column">{slots.slice(3).map(renderSlot)}</div>
        {frameArt && <img className="hero-showcase__mortarion-frame" src={import.meta.env.BASE_URL + frameArt}
          data-testid="mortarion-forged-frame" alt="" aria-hidden="true" draggable={false} />}
        {!harborReady && <div className="hero-showcase__art-gate" role="status" aria-live="polite">
          <span className="hero-showcase__art-gate-sigil" aria-hidden="true">ᛟ</span>
          <strong>{harborStatus==='error'
            ? text('Не удалось загрузить фон героя', 'Hero background unavailable')
            : text('Готовим сцену героя…', 'Preparing hero scene…')}</strong>
          {harborStatus==='error' && <button type="button" onClick={retryHarbor}>
            {text('Повторить', 'Retry')}
          </button>}
        </div>}
        <span className="hero-showcase__stage-level">{t('levelWord')} {player.level}</span>
      </div>

      <div className="hero-showcase__progress" aria-label={text('Прогресс героя','Hero progress')}>
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
      </div>

      <div className="hero-showcase__stats" aria-label={t('withEquipment')}>
        <h3 className="hero-showcase__plaque-title">{t('withEquipment')}</h3>
        <div className="hero-showcase__stat-grid">
          <div className="hero-showcase__stat"><Heart size={18} className="hero-showcase__heart" aria-hidden="true"/><span>{t('heroHealth')}<strong>{stats.maxHp}</strong></span></div>
          <div className="hero-showcase__stat"><Sword size={18} className="hero-showcase__attack" aria-hidden="true"/><span>{t('attack')}<strong>{stats.attack}</strong></span></div>
          <div className="hero-showcase__stat"><Shield size={18} className="hero-showcase__defense" aria-hidden="true"/><span>{t('defense')}<strong>{stats.defense}</strong></span></div>
          <div className="hero-showcase__stat"><Star size={18} className="hero-showcase__crit" aria-hidden="true"/><span>{t('critChance')}<strong>{stats.critChance}%</strong></span></div>
        </div>
      </div>


      <button type="button" className="hero-showcase__equipment-link" onClick={onEquipment}>
        <Shirt size={17} aria-hidden="true" />{text('Усилить героя', 'Strengthen hero')}<ChevronRight size={17} aria-hidden="true" />
      </button>

      {vipEntry}

      <section className="hero-showcase__companion" data-testid="hero-companion-journey"
        aria-label={text('Спутник героя', 'Hero companion')}>
        {activeCompanion?.id === HALLOWEEN_COMPANION_ID ? <span style={{gridRow:"1 / 3", width: "100%", height: 88}}><PumpkinWitch /></span> : <img src={activeCompanion ? getFollowerArt(activeCompanion.id)
          : import.meta.env.BASE_URL + 'assets/territory/map/icons/companions-v1.webp'}
          alt="" loading="lazy" draggable={false}/>}
        <div className="hero-showcase__companion-copy">
          <span>{activeCompanion?.id === HALLOWEEN_COMPANION_ID ? text('РЕЙД · 2026', 'RAID · 2026') : text('ПОМОЩНИК В ПОХОДЕ', 'CAMPAIGN COMPANION')}</span>
          <strong>{activeCompanion
            ? (language === 'en' ? (activeCompanionTemplate?.nameEn ?? activeCompanion.name) : activeCompanion.name)
            : text('Спутник ещё не открыт', 'No companion unlocked yet')}</strong>
          {activeCompanion && <small style={{color:rarityColor(followerRarity(activeCompanion.id)),fontWeight:900}}>{localizeRarity(followerRarity(activeCompanion.id), language)}</small>}
          <small>{activeCompanion
            ? activeCompanion.id === HALLOWEEN_COMPANION_ID ? text(`Ур. 100/100 · Атака ${followerCombat(activeCompanion).attack} · Лечение ${followerCombat(activeCompanion).heal}`, `Lv. 100/100 · Attack ${followerCombat(activeCompanion).attack} · Healing ${followerCombat(activeCompanion).heal}`)
              : activeCompanion.id === 'follower_6' ? text(`Ур. ${activeCompanion.level} · Атака ${followerCombat(activeCompanion).attack} · Лечение ${followerCombat(activeCompanion).heal}`, `Lv. ${activeCompanion.level} · Attack ${followerCombat(activeCompanion).attack} · Healing ${followerCombat(activeCompanion).heal}`)
              : text(`Ур. ${activeCompanion.level} · Атака ${followerCombat(activeCompanion).attack} · Защита ${activeCompanion.defense}`,
                `Lv. ${activeCompanion.level} · Attack ${followerCombat(activeCompanion).attack} · Defense ${activeCompanion.defense}`)
            : text('Первый спутник откроется на 3 уровне', 'First companion unlocks at hero level 3')}</small>
          <small>{text('Помогает в Походе и Испытаниях, не на Арене', 'Helps in Campaign and Trials, not Arena')}</small>
        </div>
        <button type="button" onClick={onCompanions} data-testid="hero-open-companions">
          <UsersRound size={16} aria-hidden="true"/>{text('Лагерь', 'Camp')}<ChevronRight size={15} aria-hidden="true"/>
        </button>
      </section>

      <div className="hero-showcase__journey">
        <h3 className="hero-showcase__plaque-title">{t('battlePath')}</h3>
        <div className="hero-showcase__records">
          <div><strong>{state.totalBattlesWon}</strong><span>{t('wins')}</span></div>
          <div><strong>{state.totalBossesDefeated}</strong><span>{t('bosses')}</span></div>
          <div><strong>{chapterNumber}</strong><span>{t('chapter')}</span></div>
        </div>
        <div className="hero-showcase__next" data-testid="hero-next-goal">
          {enemyImageFailed ? (
            <span className="hero-showcase__boss-art hero-showcase__boss-art--fallback" aria-hidden="true">
              <Swords size={34} />
            </span>
          ) : (
            <img className="hero-showcase__boss-art"
              src={import.meta.env.BASE_URL + nextEnemy.art.replace(/^\/+/, '')}
              alt="" loading="lazy" draggable={false}
              onError={() => setEnemyImageFailed(true)} />
          )}
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
