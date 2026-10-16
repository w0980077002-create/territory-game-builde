import type { CombatAppearance } from './appearance';

// Cosmetic-only assets; import.meta.env.BASE_URL handles GitHub Pages subpaths.
const root = import.meta.env.BASE_URL + 'assets/territory/characters/';

function frames(category: 'enemies' | 'bosses' | 'followers', id: string): CombatAppearance {
  const prefix = root + category + '/' + id + '/';
  return {
    idle: prefix + 'idle.webp',
    attack: prefix + 'attack.webp',
    block: prefix + 'block.webp',
    dodge: prefix + 'dodge.webp',
    hit: prefix + 'hit.webp',
    death: prefix + 'death.webp',
  };
}

const COMPANIONS: Record<string, string> = {
  follower_1: 'loyal_shield',
  follower_2: 'northern_warrior',
  follower_3: 'forest_healer',
  follower_4: 'moon_hunter',
  follower_5: 'rune_mage',
};

export function getFollowerCombatFrames(id: string): CombatAppearance | undefined {
  const key = COMPANIONS[id];
  return key ? frames('followers', key) : undefined;
}

export function getFollowerArt(id: string | null | undefined): string {
  return id ? getFollowerCombatFrames(id)?.idle ?? '/follower-shield.webp' : '/follower-shield.webp';
}

/** Determine the six poses from the existing enemy art without touching combat balance. */
export function getEnemyCombatFrames(art: string): CombatAppearance | undefined {
  const match = art.match(/\/assets\/territory\/characters\/(enemies|bosses)\/([a-z_]+)\/idle\.webp$/);
  if (!match) return undefined;
  return frames(match[1] as 'enemies' | 'bosses', match[2]);
}
