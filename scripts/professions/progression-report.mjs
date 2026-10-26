// Read-only model comparison; never imported by the game or a migration.
import { MASTERY_BANDS, PROFESSION_TRACKS, simulateProgression, totalXpForLevel } from './stage8-model.mjs';

function report(model) {
  const rows=[];
  for (const gathersPerDay of [2,3,4,6]) {
    const results=PROFESSION_TRACKS.map(({id})=>simulateProgression({profession:id,gathersPerDay}));
    rows.push({model,gathersPerDay,totalXp:totalXpForLevel(300),
      minimumDays:Math.min(...results.map(r=>r.days)),maximumDays:Math.max(...results.map(r=>r.days))});
  }
  return rows;
}
const current=report('existing');
// A proposal only: keep training rewards, material costs, item prices/stats,
// four-hour gathering and the server daily cap. Compare half XP thresholds.
for (const band of MASTERY_BANDS) band.xpToNext=Math.ceil(band.xpToNext/2);
console.table([...current,...report('proposal: half XP thresholds')]);
console.log('Assumes every gathered resource is spent on training. Crafting gear and missed days extend these times.');
console.log('Exclude owner test access and admin resource grants from normal-player economy measurements. No runtime balance was changed.');
