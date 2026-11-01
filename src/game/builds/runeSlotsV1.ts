/**
 * Issue #175: staged independent rune loadout. This does NOT apply effects to
 * production battles or establish ownership. Only server-owned ledger data is
 * authoritative. Five equipped skills are a completely separate contract.
 */
export const RUNE_SCHEMA = 'territory-rune-slots/1' as const;
export const RUNE_CATALOG_SCHEMA = 'territory-rune-slot-catalog/1' as const;
export type RuneSlot = { slotId: string; runeId: string | null };
export type RuneSlotConfig = { slotId: string; options: string[]; legacySkillId: string };
export type RuneSlotState = { schema: typeof RUNE_SCHEMA; revision: number; slots: RuneSlot[] };
export type RuneSnapshot = { schema: typeof RUNE_SCHEMA; revision: number; slots: (RuneSlot & { level: number })[] };
const obj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const slotIdFor = (ordinal: number) => `rune_slot_${String(ordinal).padStart(2, '0')}`;
function checkDefs(defs: readonly RuneSlotConfig[]): void {
  if (defs.length !== 15) throw Error('rune_slots_invalid');
  const legacy = new Set<string>(), runeIds = new Set<string>();
  defs.forEach((slot, i) => {
    // Slot identifiers must NEVER be borrowed from selected combat skill IDs.
    if (slot.slotId !== slotIdFor(i + 1) || !slot.legacySkillId
      || slot.legacySkillId === slot.slotId || legacy.has(slot.legacySkillId)) throw Error('rune_slots_invalid');
    legacy.add(slot.legacySkillId);
    if (!Array.isArray(slot.options) || slot.options.length < 2 || slot.options.length > 3) throw Error('rune_options_invalid');
    for (const id of slot.options) {
      if (typeof id !== 'string' || !id || runeIds.has(id)) throw Error('rune_duplicate_id');
      runeIds.add(id);
    }
  });
}
/** Explicit versioned slot catalog. Old skill IDs are MIGRATION KEYS ONLY. */
export function runeSlotCatalog(raw: unknown): RuneSlotConfig[] {
  if (!obj(raw) || raw.schema !== RUNE_CATALOG_SCHEMA || !Array.isArray(raw.slots)) throw Error('rune_catalog_invalid');
  const defs: RuneSlotConfig[] = raw.slots.map((slot, i) => {
    if (!obj(slot) || slot.ordinal !== i + 1 || typeof slot.slotId !== 'string'
      || typeof slot.legacySkillId !== 'string' || !Array.isArray(slot.options)) throw Error('rune_catalog_invalid');
    const options = slot.options.map(option => {
      if (!obj(option) || typeof option.runeId !== 'string') throw Error('rune_catalog_invalid');
      return option.runeId;
    });
    return {slotId:slot.slotId,legacySkillId:slot.legacySkillId,options};
  });
  checkDefs(defs);
  return defs;
}
export function emptyRuneSlots(defs: readonly RuneSlotConfig[], revision = 0): RuneSlotState {
  checkDefs(defs);
  if (!integer(revision)) throw Error('rune_revision_invalid');
  return {schema:RUNE_SCHEMA,revision,slots:defs.map(d=>({slotId:d.slotId,runeId:null}))};
}
/** Caller must read authoritative ownership and expected revision from server. */
export function validateRuneSlots(
  raw: unknown, defs: readonly RuneSlotConfig[],
  trusted: Readonly<Record<string,number>>, expectedRevision: number,
): RuneSlotState {
  checkDefs(defs);
  if (!obj(raw) || raw.schema !== RUNE_SCHEMA || !integer(raw.revision)) throw Error('rune_state_invalid');
  if (!integer(expectedRevision) || raw.revision !== expectedRevision) throw Error('rune_revision_conflict');
  if (!Array.isArray(raw.slots) || raw.slots.length !== 15) throw Error('rune_count_invalid');
  const slots = new Map<string,string|null>();
  for (const s of raw.slots) {
    if (!obj(s) || typeof s.slotId !== 'string' || (s.runeId !== null && typeof s.runeId !== 'string')) throw Error('rune_choice_invalid');
    if (slots.has(s.slotId)) throw Error('rune_duplicate_slot');
    slots.set(s.slotId,s.runeId);
  }
  return {schema:RUNE_SCHEMA,revision:raw.revision,slots:defs.map(d=>{
    if (!slots.has(d.slotId)) throw Error('rune_slot_missing');
    const id=slots.get(d.slotId)!;
    if (id !== null && !d.options.includes(id)) throw Error('rune_wrong_slot');
    if (id !== null && (!Object.prototype.hasOwnProperty.call(trusted,id)
      || !integer(trusted[id]) || trusted[id] < 1)) throw Error('rune_not_owned');
    return {slotId:d.slotId,runeId:id};
  })};
}
/**
 * Read-only migration proposal; never mutate legacy saves here. Explicit
 * legacySkillId -> slot mapping is fixed in the versioned catalog. A legacy
 * two-rune skill cannot fit a one-choice slot, so refuse rather than drop it.
 * Reconcile selected rank independently of max owned rank before migrating.
 */
export function migrateLegacyRunes(
  skills: readonly {skillId:string;runes:readonly {runeId:string;level:number}[]}[],
  defs: readonly RuneSlotConfig[], trusted: Readonly<Record<string,number>>, revision=0,
): RuneSlotState {
  const next=emptyRuneSlots(defs,revision), seen=new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.skillId)) throw Error('rune_duplicate_skill');
    seen.add(skill.skillId);
    if (skill.runes.length>1) throw Error('rune_legacy_ambiguous');
    if (!skill.runes.length) continue;
    const entry=defs.find(d=>d.legacySkillId===skill.skillId);
    if (!entry) throw Error('rune_unknown_skill');
    const equipped=skill.runes[0];
    if (!integer(equipped.level) || equipped.level<1
      || !Object.prototype.hasOwnProperty.call(trusted,equipped.runeId)
      || trusted[equipped.runeId]!==equipped.level) throw Error('rune_legacy_rank_conflict');
    const slot=next.slots.find(s=>s.slotId===entry.slotId)!;
    slot.runeId=equipped.runeId;
  }
  return validateRuneSlots(next,defs,trusted,revision);
}
/** Freeze trusted ranks at start, not after battle. Effects require live server integration. */
export function runeBattleSnapshot(
  state:RuneSlotState, defs:readonly RuneSlotConfig[], trusted:Readonly<Record<string,number>>,
): RuneSnapshot {
  const checked=validateRuneSlots(state,defs,trusted,state.revision);
  return {schema:RUNE_SCHEMA,revision:checked.revision,
    slots:checked.slots.map(s=>({...s,level:s.runeId===null?0:trusted[s.runeId]}))};
}
