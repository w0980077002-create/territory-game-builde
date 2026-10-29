import { generateChapter } from '../engine';
import type { IdleFighterInput } from '../idleEngine/types';
import { buildCampaign, type CampaignStage } from './campaign';

/**
 * Review-only mapping, never an authority for payouts or an approved balance.
 * The live campaign has five ordinary enemies and one boss per floor; the new
 * campaign has twenty encounters per chapter. This candidate maps new stage N
 * to legacy floor N. That mapping, omission of legacy chapter-clear rewards,
 * boss abilities, elite bonuses and cooldown rules require explicit review.
 */
export interface AdventureBalanceCandidate {
  stage: number;
  encounterId: string;
  kind: CampaignStage['kind'];
  enemyId: string;
  enemy: IdleFighterInput;
  gold: number;
  xp: number;
  items: [];
  enabled: false;
  approval: 'review_required';
  legacyFloor: number;
  legacySource: 'boss' | 'ordinary';
}

const legacyIndex: Record<string, number> = { goblin: 0, boar: 1, bandit: 2, wolf: 3, troll: 4 };

export function buildAdventureBalanceCandidate(): AdventureBalanceCandidate[] {
  return buildCampaign().map(stage => {
    const chapter = generateChapter(stage.index);
    const boss = stage.kind === 'boss';
    const enemy = boss ? chapter.boss : chapter.enemies[legacyIndex[stage.enemyId]];
    // Critical/block/dodge probabilities are review-only values from PR #96's
    // laboratory; the live round-based enemy model has no equivalent fields.
    return {
      stage: stage.index, encounterId: `adventure_v1_stage_${stage.index}`, kind: stage.kind,
      enemyId: stage.enemyId,
      enemy: {
        stats: { hp: enemy.hp, maxHp: enemy.maxHp, attack: enemy.attack, defense: enemy.defense,
          critChance: boss ? 0.14 : 0.06, dodgeChance: boss ? 0.08 : 0.07,
          blockChance: boss ? 0.18 : 0.08 },
        loadout: { skills: [], passives: [] },
      },
      gold: enemy.rewardGold, xp: enemy.rewardXp, items: [],
      enabled: false, approval: 'review_required', legacyFloor: stage.index,
      legacySource: boss ? 'boss' : 'ordinary',
    };
  });
}
