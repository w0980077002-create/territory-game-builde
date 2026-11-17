/** VIKING CompanionBrain's cause→effect and boss cower, adapted to TERRITORY
 * committed rounds. No wall-clock cooldowns or second combat engine. */
export type GooseAction = 'idle' | 'run' | 'attack' | 'dive' | 'hug' | 'commotion' | 'honk' | 'hit' | 'defeat' | 'victory' | 'cower';
export interface GooseMemory { round: number; lastDive: number; }
export const newGooseMemory = (): GooseMemory => ({ round: 0, lastDive: -3 });
