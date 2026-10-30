// Regression gate for the owner-approved #145 wood/gold UI migration.
// This is source-level coverage; browser and real Telegram checks remain separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const routeCases = [
  ['ShopScreen', 'shop'],
  ['ProfessionsScreen', 'professions'],
  ['ProfessionsStage8Screen', 'profession-stage8'],
  ['ForgeScreen', 'forge'],
  ['QuestsScreen', 'quests'],
  ['ClanScreen', 'clan'],
  ['AuctionScreen', 'auction'],
  ['LeaderboardScreen', 'leaderboard'],
  ['SeasonScreen', 'season'],
  ['FriendsScreen', 'friends'],
  ['EventsScreen', 'events'],
];
for (const [component, name] of routeCases) {
  const text = source(`src/components/${component}.tsx`);
  assert(text.includes(`viking-screen--${name}`), `${component} is not connected to the shared skin`);
}
const main = source('src/main.tsx');
const css = source('src/components/ui/vikingScreenSkin.css');
assert(main.includes("import './components/ui/vikingScreenSkin.css'"), 'shared CSS not loaded by the real game');
assert(css.includes('.territory-shell .viking-screen'), 'skin must remain scoped to the public game shell');
assert(css.includes('var(--viking-plaque)'), 'approved wooden texture not used');
assert(css.includes('.viking-screen-tabs > button[aria-selected="true"]'), 'tabs need an active appearance');
for (const component of ['ShopScreen', 'ProfessionsScreen', 'AuctionScreen']) {
  assert(source(`src/components/${component}.tsx`).includes('role="tab" aria-selected={tab ==='), `${component} lacks real selected state`);
}
assert(source('src/components/BattleScreen.tsx').includes('role="tab" aria-selected={view === t.id}'), 'campaign / trial / cave tabs must be accessible');
assert(css.includes('.viking-adventure-tabs'), 'battle tabs require themed styling');
assert(css.includes('.territory-mail__tabs'), 'inbox tabs require themed styling');
assert(css.includes('.followers-camp__header'), 'companions require wood/gold styling');
assert(css.includes('.expansion-panel__head'), 'additional panels need themed headers');
assert(css.includes('.territory-events__hero'), 'events need themed wood/gold skin');
const forge = source('src/components/ForgeScreen.tsx');
assert(forge.includes('className="forge-upgrade-panel'), 'forge modal missing');
assert(forge.includes('role="dialog" aria-modal="true"'), 'forge modal is not announced as a dialog');
assert(forge.includes("aria-label={language === 'en' ? 'Close' : 'Закрыть'}"), 'forge modal close lacks accessible name');
assert(css.includes('.forge-upgrade-panel') && css.includes('max-height: min(77dvh, 540px)'), 'forge modal must fit compact mobile viewports');
const arena = source('src/components/arena/ArenaRoom.tsx');
assert(arena.includes('role="alertdialog" aria-modal="true"'), 'arena leave prompt must be an alertdialog');
assert(arena.includes('cancelLeaveRef.current?.focus'), 'arena confirmation focus must be restored');
assert(css.includes('.arena-modal-overlay > .card'), 'arena exit dialog must be compact');
const rune = source('src/components/builds/RuneSkillBook.tsx');
assert(rune.includes('className="rune-book__dialog-body"'), 'runes must scroll within their dialog');
assert(source('src/components/builds/runeSkillBook.css').includes('max-height:min(74dvh,520px)'), 'rune dialog too tall');
const wheel = source('src/components/FortuneDialog.tsx');
assert(wheel.includes('fortune-dialog__close'), 'wheel needs a reachable close button');
assert(wheel.includes('fortune-dialog__body'), 'wheel rules need inner scrolling');
assert(wheel.includes('>OK</button>'), 'wheel receipt acknowledgement must retain OK action');
assert(source('src/components/fortune.css').includes('max-height:min(72dvh,470px)'), 'wheel dialog too tall');
const social = source('src/components/SocialQuestsSection.tsx');
const socialCss = source('src/components/socialQuestsBoard.css');
assert(social.includes("setAttempt(n => n + 1)"), 'community quests need retry without restarting the game');
assert(social.includes("aria-busy={loading || !!busy}"), 'community quests need honest loading state');
assert(social.includes("min-h-11"), 'community quest actions need 44px touch targets');
assert(social.includes("claimSocial(userId, task)"), 'claims must still use the existing server API');
assert(socialCss.includes(".social-quest-card") && socialCss.includes("var(--viking-plaque)"), 'community quest board must use approved wood/gold UI');
console.log('Community quests #145 gate: real server claim preserved, retry, 44px controls and approved visual skin.');
console.log('Territory #145 visual coverage gate: 11 real routes plus battle/arena/runes/companions/events/mail/casino/forge popup structure. Browser Telegram verification remains separate.');
