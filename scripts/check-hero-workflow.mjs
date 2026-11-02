import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const files = [
  'src/App.tsx',
  'src/components/HeroShowcase.tsx',
  'src/components/ProfileScreen.tsx',
  'src/components/InventoryScreen.tsx',
  'src/components/ForgeScreen.tsx',
  'src/components/BattleScreen.tsx',
];
for (const path of files) {
  const tree = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(tree.parseDiagnostics.length, 0, path + ': JSX/TypeScript syntax');
}
const app = readFileSync(files[0], 'utf8');
const hero = readFileSync(files[1], 'utf8');
const profile = readFileSync(files[2], 'utf8');
const inventory = readFileSync(files[3], 'utf8');
const forge = readFileSync(files[4], 'utf8');
const battle = readFileSync(files[5], 'utf8');
assert.match(app, /onForge=\{\(equipmentId\) => openForge\(equipmentId\)\}/, 'Hero must focus the real forge item');
assert.match(app, /onQuests=\{\(\) => setScreen\('quests'\)\}/, 'Hero must open real quests');
assert.match(app, /<ForgeScreen[\s\S]*?onBattle=\{\(\) => \{ setBattleView\(forgeReturnBattleView \?\? 'campaign'\); setForgeReturnBattleView\(null\); setAutoStart\(false\); setScreen\('battle'\); \}\}/, 'Forge returns to the saved classic mode without auto-spend');
assert.match(app, /returnBattleView=\{battlePrepReturn\}/, 'Inventory receives only deliberate battle preparation return context');
assert.match(app, /setBattleView\(battlePrepReturn \?\? 'campaign'\)/, 'Inventory returns to the selected classic mode or defaults to campaign');
assert.match(app, /setBattlePrepReturn\(battleView === 'trial' \? 'trial' : 'campaign'\)/, 'Battle records the actual classic mode before opening equipment');
assert.match(app, /setAutoStart\(false\);\s*setScreen\('battle'\);/, 'Returning from equipment never starts a fight or spends stones');
assert.match(app, /screen !== 'battle' && screen !== 'inventory'/, 'Leaving the preparation journey clears the stale return mode');
assert.match(profile, /<HeroShowcase state=\{state\} stats=\{computed\} onEquipment=\{onEquipment\} onAdventure=\{onAdventure\} onForge=\{onForge\} onQuests=\{onQuests\}/, 'Profile must pass all real actions');
assert.match(hero, /state\.quests\.some\(quest => !quest\.claimed && quest\.current >= quest\.target\)/, 'Claim CTA only for genuinely ready quest');
assert.match(hero, /Object\.values\(player\.equipped\)\.find/, 'Forge CTA only for saved equipped item');
assert.match(hero, /onForge\(forgeCandidate\.id\)/, 'Forge receives actual equipment ID');
assert.match(hero, /data-testid="hero-preparation-actions"/, 'Hero preparation exists');
assert.match(hero, /chapterWins \/ chapter\.winsNeeded/, 'Real campaign progress preserved');
assert.doesNotMatch(hero, /useGame\.set|claimQuest|rewardGold|grantReward/, 'Hero overview never awards or mutates');
assert.match(inventory, /data-testid="equipment-campaign-return"/, 'Equipment return path exists for all hero levels');
assert.doesNotMatch(inventory, /onBattle && state\.player\.level < 5/, 'Veterans must not lose return path');
assert.match(inventory, /EQUIPMENT_SLOTS\.filter/, 'Equipped count uses actual saved slots');
assert.match(inventory, /returningToTrial \? generateTrial\(state\.trialLevel\)\.art : chapter\.boss\.art/, 'Inventory shows the actual enemy for the return mode');
assert.match(inventory, /returningToTrial \? battleReturnLabel/, 'Equipment and consumables offer a correctly labeled return');
assert.match(inventory, /\{battleReturnLabel\} <ChevronRight/, 'Companions also preserve the return label');
assert.match(battle, /data-testid="battle-preparation-journey"/, 'Battle has an actual hero preparation route');
assert.match(battle, /data-testid="battle-open-equipment"/, 'Battle opens real saved equipment');
assert.match(battle, /data-testid="battle-open-quests"/, 'Battle opens real quests');
assert.match(battle, /EQUIPMENT_SLOTS\.filter/, 'Battle readiness uses saved equipped slots, not decorative placeholders');
assert.match(battle, /getComputedStats\(state\)\.attack/, 'Battle preview shows computed classic PvE stats');
assert.match(battle, /caveRecoveryNeeded/, 'Unresolved cave receipts remain guarded');
assert.match(battle, /<ServerAdventureScreen userId=\{userId\}/, 'Server Cave route remains untouched');
assert.match(forge, /disabled=\{upgrading \|\| saveUnverified\}/, 'No navigation away from unconfirmed forge');
assert.match(forge, /data-testid="forge-journey-navigation"/, 'Forge navigation visible');
assert.match(forge, /const saved = await saveCloudSave\(userId, result\.next\)/, 'Forge receipt path unchanged');
console.log('Hero journey PASS: hero → equipment/quests/forge → campaign, battle → equipment → same Campaign/Trials mode; actual saved stats and no auto-spend.');

// Mobile review CI also covers the complete warehouse preparation journey.
import './check-inventory-preparation.mjs';
