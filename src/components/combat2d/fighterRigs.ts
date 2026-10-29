/** Only hand-prepared, inspected cutout sets may enter this allowlist.
 * Never infer a rig from a skin name or silently replace an unrigged character. */
export type RigId = 'male_viking' | 'goblin';
export interface FighterRigDefinition {
  id: RigId;
  faces: 1 | -1;
  skin: string;
  cloth: string;
}
const RIGS: Record<RigId, FighterRigDefinition> = {
  male_viking: { id: 'male_viking', faces: 1, skin: '#e99a59', cloth: '#1765b6' },
  goblin: { id: 'goblin', faces: -1, skin: '#789928', cloth: '#a92d20' },
};
export function getFighterRig(idleArt: string): FighterRigDefinition | undefined {
  const match = idleArt.match(/\/characters\/(heroes\/male_viking|enemies\/goblin)\/idle\.webp(?:[?#].*)?$/);
  if (!match) return undefined;
  return RIGS[match[1].endsWith('male_viking') ? 'male_viking' : 'goblin'];
}
export function rigAsset(rig: FighterRigDefinition, part: string): string {
  return `${import.meta.env.BASE_URL}assets/territory/combat2d/${rig.id}/${part}.webp`;
}
