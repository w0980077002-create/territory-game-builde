import type { SlotGrid, SlotOutcome } from './vikingSlots';
import type { BonusTile, RiskCard, SuperChest } from './slotAdventure';

/** Per-player, local-only DEMO state. Never authoritative or redeemable. */
export const DEMO_VERSION = 3;
export type SavedSlotPhase = 'ready' | 'spinning' | 'decision' | 'bonus' | 'bonus-ended'
  | 'bonus-complete' | 'superbonus' | 'superbonus-reveal' | 'risk' | 'risk-reveal';
export type SlotDemoState = {
  balance:number; lines:1|3|5|7|9; bet:1|2|5|10; phase:SavedSlotPhase;
  wagerAtSpin:number; pending:number; field:SlotGrid; recent:SlotOutcome|null;
  bonusLeft:number; bonusShield:number; bonusDeck:BonusTile[]; bonusOpened:number[];
  superDeck:SuperChest[]; superOpened:number|null; riskDeck:RiskCard[];
  riskOpened:number|null; riskSteps:number; auto:0; soundOn:boolean; hapticsOn:boolean;
};
const lines=[1,3,5,7,9],bets=[1,2,5,10];
const symbols=new Set(['hero','wild','boss','wolf','follower','sword','helmet','gem','gold']);
const phases=new Set<SavedSlotPhase>(['ready','spinning','decision','bonus','bonus-ended','bonus-complete','superbonus','superbonus-reveal','risk','risk-reveal']);
const num=(v:unknown,max=1_000_000_000):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const gridValid=(grid:unknown):grid is SlotGrid=>
  Array.isArray(grid)&&grid.length===5&&grid.every((reel:unknown)=>Array.isArray(reel)&&reel.length===3&&reel.every((cell:unknown)=>symbols.has(String(cell))));
const deckValid=(v:unknown):v is BonusTile[]=>Array.isArray(v)&&v.length===5&&v.every((t:unknown)=>typeof t==='object'&&t!==null&&
  'kind' in t&&['treasure','shield','trap'].includes(String(t.kind))&&'payout'in t&&num(t.payout,10000));
const superValid=(v:unknown):v is SuperChest[]=>Array.isArray(v)&&v.length===3&&v.every((t:unknown)=>typeof t==='object'&&t!==null&&
  'payout'in t&&num(t.payout,10000));
const riskValid=(v:unknown):v is RiskCard[]=>Array.isArray(v)&&v.length===4&&v.every((t:unknown)=>typeof t==='object'&&t!==null&&
  'wins' in t&&typeof t.wins==='boolean');
const openedValid=(v:unknown):v is number[]=>Array.isArray(v)&&v.length<=5&&v.every((x:unknown)=>num(x,4))&&new Set(v).size===v.length;

export function slotSaveKey(userId:string):string {
  // Avoid accidental cross-player demo credits on shared phones.
  return 'territory:slots:demo:v3:'+encodeURIComponent(userId.slice(0,100));
}
export function parseSlotDemo(raw:string|null):SlotDemoState|null {
  if (!raw||raw.length>16000) return null;
  try {
    const data=JSON.parse(raw) as {version?:unknown;state?:unknown};
    if (data.version!==DEMO_VERSION||!data.state||typeof data.state!=='object')return null;
    const x=data.state as Record<string,unknown>;
    if (!num(x.balance)||!num(x.pending)||!num(x.wagerAtSpin,90)||
      !lines.includes(Number(x.lines))||!bets.includes(Number(x.bet))||
      !phases.has(x.phase as SavedSlotPhase)||!gridValid(x.field)||
      !num(x.bonusLeft,5)||!num(x.bonusShield,5)||!num(x.riskSteps,5)||
      !openedValid(x.bonusOpened)||
      !(x.superOpened===null||num(x.superOpened,2))||
      !(x.riskOpened===null||num(x.riskOpened,3))||
      typeof x.soundOn!=='boolean'||typeof x.hapticsOn!=='boolean')return null;
    const phase=x.phase as SavedSlotPhase;
    if (phase.startsWith('bonus')&&!deckValid(x.bonusDeck))return null;
    if (phase.startsWith('superbonus')&&!superValid(x.superDeck))return null;
    if (phase.startsWith('risk')&&!riskValid(x.riskDeck))return null;
    const recent=x.recent as SlotOutcome|null;
    if (recent!==null && (typeof recent!=='object'||!gridValid(recent.grid)||
        !Array.isArray(recent.lines)||!num(recent.payout)||!num(recent.bonusSymbols,15)))return null;
    // A closed tab during a paid demo spin cannot leave an unresolved debit.
    // Refund only that unfinished demo stake and return to ready.
    return {
      ...(x as SlotDemoState),
      phase:phase==='spinning'?'ready':phase,
      balance:phase==='spinning'?Math.min(1_000_000_000,(x.balance as number)+(x.wagerAtSpin as number)):x.balance as number,
      pending:phase==='spinning'?0:x.pending as number,
      recent:phase==='spinning'?null:recent,
      auto:0,
    };
  } catch { return null; }
}
export function loadSlotDemo(userId:string):SlotDemoState|null {
  try { return parseSlotDemo(window.localStorage.getItem(slotSaveKey(userId))); }
  catch {return null;}
}
export function saveSlotDemo(userId:string,state:SlotDemoState):void {
  try { window.localStorage.setItem(slotSaveKey(userId),JSON.stringify({version:DEMO_VERSION,state})); }
  catch { /* Private browsing, full storage or unavailable WebView storage. */ }
}
