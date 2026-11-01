/** Staged 15-slot rune contract. Not a live reward, save or battle route. */
export const RUNE_SCHEMA = 'territory-rune-slots/1' as const;
export type RuneSlot = { slotId: string; runeId: string | null };
export type RuneSlotConfig = { slotId: string; options: string[] };
export type RuneSlotState = { schema: typeof RUNE_SCHEMA; revision: number; slots: RuneSlot[] };
export type RuneSnapshot = { schema: typeof RUNE_SCHEMA; revision: number; slots: (RuneSlot & { level: number })[] };
const obj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
function checkDefs(defs: readonly RuneSlotConfig[]): void {
  if (defs.length !== 15 || new Set(defs.map(x => x.slotId)).size !== 15) throw Error('rune_slots_invalid');
  if (defs.some(x => x.options.length < 2 || x.options.length > 3 || new Set(x.options).size !== x.options.length)) throw Error('rune_options_invalid');
  const ids = defs.flatMap(x => x.options);
  if (new Set(ids).size !== ids.length) throw Error('rune_duplicate_id');
}
export function runeSlotCatalog(visual: unknown): RuneSlotConfig[] {
  if (!obj(visual) || !Array.isArray(visual.groups)) throw Error('rune_catalog_invalid');
  const defs: RuneSlotConfig[] = [];
  for (const group of visual.groups) {
    if (!obj(group) || !Array.isArray(group.skills)) throw Error('rune_catalog_invalid');
    for (const skill of group.skills) {
      if (!obj(skill) || typeof skill.id !== 'string' || !skill.id || !Array.isArray(skill.runes)) throw Error('rune_catalog_invalid');
      const options = skill.runes.map((rune: unknown) => {
        if (!obj(rune) || typeof rune.id !== 'string' || !rune.id) throw Error('rune_catalog_invalid');
        return rune.id;
      });
      defs.push({slotId: skill.id, options});
    }
  }
  checkDefs(defs);
  return defs;
}
export function emptyRuneSlots(defs: readonly RuneSlotConfig[], revision = 0): RuneSlotState {
  checkDefs(defs);
  if (!integer(revision)) throw Error('rune_revision_invalid');
  return {schema: RUNE_SCHEMA, revision, slots: defs.map(d => ({slotId:d.slotId,runeId:null}))};
}
/** Ownership and current revision MUST come from trusted server records. */
export function validateRuneSlots(
  raw: unknown, defs: readonly RuneSlotConfig[], trusted: Readonly<Record<string, number>>, expectedRevision: number,
): RuneSlotState {
  checkDefs(defs);
  if (!obj(raw) || raw.schema !== RUNE_SCHEMA || !integer(raw.revision)) throw Error('rune_state_invalid');
  if (raw.revision !== expectedRevision) throw Error('rune_revision_conflict');
  if (!Array.isArray(raw.slots) || raw.slots.length !== 15) throw Error('rune_count_invalid');
  const slots = new Map<string, string | null>();
  for (const s of raw.slots) {
    if (!obj(s) || typeof s.slotId !== 'string' || (s.runeId !== null && typeof s.runeId !== 'string')) throw Error('rune_choice_invalid');
    if (slots.has(s.slotId)) throw Error('rune_duplicate_slot');
    slots.set(s.slotId, s.runeId);
  }
  return {schema:RUNE_SCHEMA,revision:raw.revision,slots:defs.map(d => {
    if (!slots.has(d.slotId)) throw Error('rune_slot_missing');
    const id = slots.get(d.slotId)!;
    if (id !== null && !d.options.includes(id)) throw Error('rune_wrong_slot');
    if (id !== null && (!Object.prototype.hasOwnProperty.call(trusted,id) || !integer(trusted[id]) || trusted[id] < 1)) throw Error('rune_not_owned');
    return {slotId:d.slotId,runeId:id};
  })};
}
/** Refuse legacy data that cannot fit without discarding a rune. */
export function migrateLegacyRunes(
  skills: readonly { skillId:string; runes:readonly {runeId:string;level:number}[] }[],
  defs: readonly RuneSlotConfig[], trusted: Readonly<Record<string,number>>, revision=0,
): RuneSlotState {
  const next=emptyRuneSlots(defs,revision), seen=new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.skillId)) throw Error('rune_duplicate_skill');
    seen.add(skill.skillId);
    if (skill.runes.length>1) throw Error('rune_legacy_ambiguous');
    if (!skill.runes.length) continue;
    // The new model derives rank from ownership. A legacy selection can carry
    // a lower rank: migrating it would silently change its combat effect.
    // Preserve the original record and require reconciliation instead.
    const equipped = skill.runes[0];
    if (!integer(equipped.level) || equipped.level < 1
      || !Object.prototype.hasOwnProperty.call(trusted, equipped.runeId)
      || trusted[equipped.runeId] !== equipped.level) throw Error('rune_legacy_rank_conflict');
    const slot=next.slots.find(s=>s.slotId===skill.skillId);
    if (!slot) throw Error('rune_unknown_skill');
    slot.runeId=equipped.runeId;
  }
  return validateRuneSlots(next,defs,trusted,revision);
}
/** Server-side snapshot projection, not implementation of PvE/PvP effects. */
export function runeBattleSnapshot(
  state:RuneSlotState, defs:readonly RuneSlotConfig[], trusted:Readonly<Record<string,number>>,
): RuneSnapshot {
  const checked=validateRuneSlots(state,defs,trusted,state.revision);
  return {schema:RUNE_SCHEMA,revision:checked.revision,
    slots:checked.slots.map(s=>({...s,level:s.runeId===null?0:trusted[s.runeId]}))};
}
