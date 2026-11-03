/** Presentation-only translations for the two sealed Halloween 2026 reward mails.
 * Server grant payload and player entitlement remain the authority.
 */
export type HalloweenMailLanguage = 'ru' | 'en';
export interface HalloweenMailSummary {
  subject: string;
  body: string;
  payload: { gold?: number; gems?: number; stones?: number };
}

const participationSubject = '🎃 Твоя награда за Хэллоуинский рейд!';
const top20Subject = '🎃 Награда за место в топ-20 рейда!';

export function localizedHalloweenMail(
  mail: HalloweenMailSummary,
  language: HalloweenMailLanguage,
): { subject: string; body: string } {
  if (language !== 'en') return { subject: mail.subject, body: mail.body };

  if (mail.subject === participationSubject) {
    // These event notices were sent in RU and EN paragraphs. Show the chosen language only.
    const english = mail.body.split(/\n\s*\n/).find(paragraph =>
      paragraph.startsWith('Congratulations on defeating the Pumpkin King!'));
    return {
      subject: '🎃 Your Halloween Raid Reward!',
      body: english ?? 'Your legendary Level 100 Pumpkin Witch has been credited. Open Inventory → Companions to select her. Top-20 prizes are separate.',
    };
  }

  if (mail.subject === top20Subject) {
    const { gold, gems, stones } = mail.payload;
    // Never invent amounts from a free-text mail; only use the sealed server payload.
    if (![gold, gems, stones].every(n => Number.isSafeInteger(n) && (n ?? -1) >= 0)) {
      return { subject: mail.subject, body: mail.body };
    }
    const place = mail.body.match(/занял\s+(\d+)-е\s+место/i)?.[1];
    const rank = place ? `#${place}` : 'in the top 20';
    return {
      subject: '🎃 Halloween Raid — Top 20 Prize!',
      body: `Congratulations! You placed ${rank} in the TERRITORY Halloween raid. Your prize includes ${gems} Blue Gems, ${gold} Gold, ${stones} Battle Stones, and the permanent rare Horned Pumpkin helmet (+6 Defense, +40 HP, +1% Critical Chance). Claim the gift from your mail if it is still unclaimed. The legendary Pumpkin Witch is credited separately to all eligible participants.`,
    };
  }

  return { subject: mail.subject, body: mail.body };
}
