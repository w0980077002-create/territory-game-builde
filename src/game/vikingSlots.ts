/**
 * TERRITORY Viking Slots — independent, play-credit-only preview.
 *
 * IMPORTANT: This randomizer and wallet are not a source of server rewards.
 * Real tickets / gold MUST be atomically debited and credited on the server.
 */
export type SlotSymbol = 'hero' | 'wild' | 'boss' | 'wolf' | 'follower' | 'sword' | 'helmet' | 'gem' | 'gold';
export type SlotGrid = SlotSymbol[][]; // [reel][row]
export type WinningLine = { number: number; count: number; symbol: SlotSymbol; payout: number; positions: number[][] };
export type SlotOutcome = { grid: SlotGrid; lines: WinningLine[]; payout: number; bonusSymbols: number; stops?: number[] };

export const SLOT_ICONS: Record<SlotSymbol, { image: string; ru: string; en: string }> = {
  hero: { image: 'assets/territory/characters/heroes/female_warrior/idle.webp', ru: 'Герой — бонус', en: 'Hero — bonus' },
  wild: { image: 'territory-mark.svg', ru: 'Руна WILD', en: 'Wild rune' },
  boss: { image: 'assets/territory/characters/bosses/northern_jarl/idle.webp', ru: 'Босс', en: 'Boss' },
  wolf: { image: 'assets/territory/characters/enemies/wolf/idle.webp', ru: 'Волк', en: 'Wolf' },
  follower: { image: 'assets/territory/characters/followers/rune_mage/idle.webp', ru: 'Спутник', en: 'Companion' },
  sword: { image: 'assets/territory/ui/items/sword.webp', ru: 'Оружие', en: 'Weapon' },
  helmet: { image: 'assets/territory/ui/equipment/helmet.webp', ru: 'Шлем', en: 'Helmet' },
  gem: { image: 'blue-gem.webp', ru: 'Алмаз', en: 'Gem' },
  gold: { image: 'gold-coin.webp', ru: 'Монеты', en: 'Gold' },
};

/** Exactly nine selectable left/right paylines on a 5×3 board. */
export const SLOT_LINES: readonly (readonly number[])[] = [
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2], [0,0,1,2,2],
  [2,2,1,0,0], [1,0,0,0,1], [1,2,2,2,1],
];
export const SLOT_LINE_CHOICES = [1,3,5,7,9] as const;
export const SLOT_BET_CHOICES = [1,2,5,10] as const;
/** Multipliers for 3, 4 and 5 matching icons; this is NOT the Igrosoft paytable. */
export const SLOT_PAYTABLE: Partial<Record<SlotSymbol, readonly [number,number,number]>> = {
  wild: [24,80,240], boss: [16,52,152], wolf: [12,36,112],
  follower: [10,30,88], sword: [8,24,72], helmet: [6,18,56],
  gem: [5,14,44], gold: [4,10,32],
};
/**
 * Actual virtual reel strips: each reel has a fixed cyclic arrangement.
 * One stop per reel determines all three vertically adjacent symbols.
 * This is a DEMO configuration; no server currency is ever paid by it.
 */
const REEL_COUNTS: readonly (readonly [SlotSymbol,number])[] = [
  ['gold',8],['gem',7],['helmet',6],['sword',5],
  ['follower',4],['wolf',4],['boss',3],['wild',1],['hero',2],
];
function buildReelStrip(reel:number):readonly SlotSymbol[] {
  const result:SlotSymbol[] = REEL_COUNTS.flatMap(([symbol,count])=>Array.from({length:count},()=>symbol));
  // Deterministic build-time permutation, never a payout RNG.
  let seed = (0x9e3779b9 ^ ((reel+1)*0x45d9f3b))>>>0;
  for (let i=result.length-1;i>0;i--) {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0;
    const j = seed%(i+1);
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}
export const SLOT_REEL_STRIPS:readonly (readonly SlotSymbol[])[] =
  Array.from({length:5},(_,reel)=>buildReelStrip(reel));
export function gridFromReelStops(stops:readonly number[]):SlotGrid {
  if (stops.length!==5||stops.some((stop,reel)=>!Number.isSafeInteger(stop)||stop<0||stop>=SLOT_REEL_STRIPS[reel].length)) {
    throw Error('slot_invalid_stops');
  }
  return stops.map((stop,reel)=> {
    const strip=SLOT_REEL_STRIPS[reel];
    return [strip[stop],strip[(stop+1)%strip.length],strip[(stop+2)%strip.length]];
  });
}
export function reelSpinTrail(reel:number,stop:number,length:number):SlotSymbol[] {
  if(!Number.isInteger(reel)||reel<0||reel>=5||!Number.isInteger(length)||length<1||length>48||
     !Number.isInteger(stop)||stop<0||stop>=SLOT_REEL_STRIPS[reel].length)throw Error('slot_invalid_trail');
  const strip=SLOT_REEL_STRIPS[reel];
  return Array.from({length},(_,i)=>strip[((stop-length+i)%strip.length+strip.length)%strip.length]);
}
export function fairDemoInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 1_000_000) throw Error('Invalid range');
  // Rejection sampling avoids modulo bias. Browser crypto is a preview RNG only.
  const span = 0x1_0000_0000;
  const threshold = span - (span % maxExclusive);
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= threshold);
  return sample[0] % maxExclusive;
}
function rollReelStops():number[] {
  return SLOT_REEL_STRIPS.map(strip=>fairDemoInt(strip.length));
}
export function makeSlotGrid():SlotGrid {
  return gridFromReelStops(rollReelStops());
}
export function scoreSlotGrid(grid: SlotGrid, activeLines: number, betPerLine: number): SlotOutcome {
  if (grid.length !== 5 || grid.some(reel => reel.length !== 3)) throw Error('Invalid grid');
  if (!SLOT_LINE_CHOICES.includes(activeLines as 1|3|5|7|9) ||
    !SLOT_BET_CHOICES.includes(betPerLine as 1|2|5|10)) throw Error('Invalid bet');
  const wins: WinningLine[] = [];
  let total = 0;
  for (let l=0; l<activeLines; l++) {
    const rowMap = SLOT_LINES[l];
    const values = rowMap.map((row, reel) => grid[reel][row]);
    let best: WinningLine | null = null;
    // Try both edges. The same five-symbol win is counted only once.
    for (const reversed of [false, true]) {
      const ordered = reversed ? [...values].reverse() : values;
      const candidates = ordered[0] === 'wild'
        ? (Object.keys(SLOT_PAYTABLE) as SlotSymbol[])
        : [ordered[0]];
      for (const target of candidates) {
        if (target === 'hero') continue; // Hero is bonus/scatter, never a line award.
        let count = 0;
        for (const cell of ordered) {
          if (cell !== target && cell !== 'wild') break;
          count++;
        }
        const multipliers = SLOT_PAYTABLE[target];
        if (count < 3 || !multipliers) continue;
        const payout = multipliers[count - 3] * betPerLine;
        if (best && best.payout >= payout) continue;
        const indices = Array.from({length:count}, (_,i)=> reversed ? 4-i : i);
        best = {number:l+1,count,symbol:target,payout,
          positions:indices.map(reel=>[reel,rowMap[reel]])};
      }
    }
    if (best) { wins.push(best); total += best.payout; }
  }
  const bonusSymbols = grid.flat().filter(s=>s==='hero').length;
  return { grid, lines:wins, payout:total, bonusSymbols };
}
export function spinVikingSlots(activeLines:number,betPerLine:number):SlotOutcome {
  const stops=rollReelStops();
  return {...scoreSlotGrid(gridFromReelStops(stops),activeLines,betPerLine),stops};
}
