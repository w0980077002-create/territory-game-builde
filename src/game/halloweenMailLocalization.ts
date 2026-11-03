/** Read-only bilingual presentation of already-issued Halloween prizes.
 * The underlying grant ID, payload, claimed_at, and companion entitlement never
 * change when a different language is selected.
 */
export type HalloweenMailLanguage = 'ru' | 'en';
export interface HalloweenMailSummary {
  subject: string;
  body: string;
  payload: { gold?: number; gems?: number; stones?: number; items?: Record<string, number> };
}

export const HALLOWEEN_FINAL_SUBJECT = '🎃 Поздравляем! Награды за Хэллоуин 2026';
const participationSubject = '🎃 Твоя награда за Хэллоуинский рейд!';
const top20Subject = '🎃 Награда за место в топ-20 рейда!';

const verifiedGiftNumbers = (p: HalloweenMailSummary['payload']): p is
  { gold: number; gems: number; stones: number; items?: Record<string, number> } =>
  [p.gold, p.gems, p.stones].every(n => Number.isSafeInteger(n) && (n ?? -1) >= 0);

export function localizedHalloweenMail(
  mail: HalloweenMailSummary,
  language: HalloweenMailLanguage,
): { subject: string; body: string } {
  if (language !== 'en') {
    // Read-only correction of outdated rarity wording in already-issued Halloween letters.
    // Never alter the stored mail, payload, reward receipt or player data.
    const halloweenLetter = [HALLOWEEN_FINAL_SUBJECT, participationSubject, top20Subject].includes(mail.subject);
    return {
      subject: mail.subject,
      body: halloweenLetter
        ? mail.body.replace(/Легендарная Тыквенная ведьма/gi, 'Эпическая Тыквенная ведьма')
          .replace(/легендарную Тыквенную ведьму/gi, 'эпическую Тыквенную ведьму')
        : mail.body,
    };
  }

  if (mail.subject === HALLOWEEN_FINAL_SUBJECT) {
    const helmet = mail.payload.items?.halloween_horned_pumpkin_2026 === 1;
    if (helmet && verifiedGiftNumbers(mail.payload)) {
      const place = mail.body.match(/занял\s+(\d+)-е\s+место/i)?.[1];
      const rank = place ? `#${place}` : 'in the top 20';
      return {
        subject: '🎃 Congratulations! Your Halloween 2026 Rewards',
        body: `Congratulations on defeating the Pumpkin King! Thank you for fighting in the TERRITORY Halloween raid.\n\n🏆 You placed ${rank}.\n🎁 Your rewards:\n• Epic Pumpkin Witch, level 100 — linked to your account, available in Companions after synchronization.\n• Rare Horned Pumpkin helmet — already credited to your equipment.\n• ${mail.payload.gems} Blue Gems.\n• ${mail.payload.gold} Gold.\n• ${mail.payload.stones} Battle Stones.\n\nAll ranking rewards have already been credited. You do not need to claim them again. Thank you for being part of TERRITORY!\n\n— TERRITORY Team`,
      };
    }
    return {
      subject: '🎃 Congratulations! Your Halloween 2026 Rewards',
      body: 'Congratulations on defeating the Pumpkin King! Thank you for joining the TERRITORY Halloween raid.\n\n🎁 Your reward: the epic Level 100 Pumpkin Witch is permanently assigned to your account. She will appear in Inventory → Companions after your game synchronizes. You do not need to claim her from this message.\n\nThank you for being part of TERRITORY!\n\n— TERRITORY Team',
    };
  }

  // Preserve localization of already-cached legacy mail until a refresh.
  if (mail.subject === participationSubject) {
    const english = mail.body.split(/\n\s*\n/).find(paragraph =>
      paragraph.startsWith('Congratulations on defeating the Pumpkin King!'));
    return {
      subject: '🎃 Your Halloween Raid Reward!',
      body: english ?? 'Your epic Level 100 Pumpkin Witch is credited. Open Inventory → Companions to select her.',
    };
  }

  if (mail.subject === top20Subject && verifiedGiftNumbers(mail.payload)) {
    const place = mail.body.match(/занял\s+(\d+)-е\s+место/i)?.[1];
    const rank = place ? `#${place}` : 'in the top 20';
    return {
      subject: '🎃 Halloween Raid — Top 20 Prize!',
      body: `Congratulations! You placed ${rank} in the TERRITORY Halloween raid. Your prize includes ${mail.payload.gems} Blue Gems, ${mail.payload.gold} Gold, ${mail.payload.stones} Battle Stones, and a rare Horned Pumpkin helmet. The Level 100 epic Pumpkin Witch is assigned separately to eligible participants.`,
    };
  }

  return { subject: mail.subject, body: mail.body };
}
