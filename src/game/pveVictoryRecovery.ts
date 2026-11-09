import type { GameState } from './types';
import { saveCloudSave, saveTokens } from './cloud';
import { validSaveToken } from './saveToken';
import { validEconomySnapshot } from './economyInvariant';
import { supabase } from './supabase';

/**
 * Legacy Campaign/Trials victory WAL (write-ahead log).
 *
 * This is a local durability checkpoint, NOT a trusted reward ledger. The
 * original battle still resolves locally. Never replay combat, apply a reward
 * twice, or overwrite a newer server revision when recovering.
 */
type VictoryJournal = {
  version: 1;
  playerId: string;
  baseRevision: string;
  snapshot: GameState;
};
type StoredJournal = { journal: VictoryJournal; serialized: string };
type RecoveryProfile = {
  state: GameState;
  saveRevision: string;
  savedGameState: unknown;
  walletGold: number;
  walletGems: number;
};
const PREFIX = 'territory:pve-victory-wal:v1:';
const PROBE = 'territory:pve-victory-wal:probe';
const ARCHIVE_PREFIX = 'territory:pve-victory-unresolved:v1:';
const MAX_ARCHIVED_CHECKPOINTS = 16;

/**
 * Recovery archive for a locally unresolved legacy victory.
 * Never trust or apply the local victory to the server and never discard its
 * evidence. Copy the exact WAL bytes to a separate verified local archive
 * before releasing the blocking marker. The cloud hero stays canonical until
 * support can reconcile any disputed rewards.
 *
 * Caller must have freshly authenticated and loaded an owner-scoped cloud row.
 */
export function archiveUnresolvedPveVictoryForCloudEntry(playerId: string): boolean {
  if (!playerId.trim() || !validSaveToken(saveTokens.get(playerId))) return false;
  const sourceKey = key(playerId);
  try {
    const original = localStorage.getItem(sourceKey);
    if (original === null) return false;
    let destination: string | null = null;
    for (let i = 0; i < MAX_ARCHIVED_CHECKPOINTS; i++) {
      const candidate = ARCHIVE_PREFIX + playerId + ':' + i;
      const saved = localStorage.getItem(candidate);
      if (saved === original || saved === null) {
        destination = candidate;
        if (saved === null) localStorage.setItem(candidate, original);
        break;
      }
    }
    // Archive storage missing, full, or externally changed: keep WAL and block.
    if (!destination || localStorage.getItem(destination) !== original
      || localStorage.getItem(sourceKey) !== original) return false;
    localStorage.removeItem(sourceKey);
    return localStorage.getItem(sourceKey) === null
      && localStorage.getItem(destination) === original;
  } catch {
    return false;
  }
}

export function hasUnresolvedPveVictoryArchive(playerId: string): boolean {
  if (!playerId.trim()) return false;
  try {
    for (let i = 0; i < MAX_ARCHIVED_CHECKPOINTS; i++) {
      if (localStorage.getItem(ARCHIVE_PREFIX + playerId + ':' + i) !== null) return true;
    }
  } catch {
    // Never claim a clean reconciliation when local storage cannot be read.
    return true;
  }
  return false;
}


function key(playerId: string): string {
  return PREFIX + playerId;
}

/** Compare JSON values regardless of postgres jsonb key ordering. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => sameJson(value, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  const others = Object.keys(right);
  return keys.length === others.length && keys.every(k => Object.prototype.hasOwnProperty.call(right, k)
    && sameJson(left[k], right[k]));
}

/**
 * PostgreSQL's territory_normalize_state_v4 rewrites derived baseline stats
 * and balanceVersion during every guarded save. They are not reward fields.
 * Compare every other serialized key exactly so a coalesced unrelated save,
 * missing loot, inventory change, or a stale victory can never look confirmed.
 */
function comparableStoredVictory(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete copy.balanceVersion; // normalized to 4 by the live trigger
  if (copy.player && typeof copy.player === 'object' && !Array.isArray(copy.player)) {
    const player = copy.player as Record<string, unknown>;
    const existing = player.stats;
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      const stats = existing as Record<string, unknown>;
      for (const field of ['maxHp','hp','attack','defense','critChance','critDamage']) delete stats[field];
      player.stats = stats;
    } else {
      player.stats = {};
    }
  }
  return copy;
}
function samePersistedVictory(a: unknown, b: unknown): boolean {
  return sameJson(comparableStoredVictory(a), comparableStoredVictory(b));
}

function readJournal(playerId: string): StoredJournal | null | 'invalid' {
  if (!playerId) return 'invalid';
  try {
    const serialized = localStorage.getItem(key(playerId));
    if (serialized === null) return null;
    const record: unknown = JSON.parse(serialized);
    if (!record || typeof record !== 'object' || Array.isArray(record)) return 'invalid';
    const journal = record as VictoryJournal;
    if (journal.version !== 1 || journal.playerId !== playerId
      || !validSaveToken(journal.baseRevision) || !validEconomySnapshot(journal.snapshot)) return 'invalid';
    return { journal, serialized };
  } catch {
    // Unreadable or corrupt storage must fail closed, never erase a marker.
    return 'invalid';
  }
}

/** Fail closed before charging battle stones if persistent storage is disabled. */
export function canJournalPveVictory(): boolean {
  try {
    localStorage.setItem(PROBE, '1');
    const ok = localStorage.getItem(PROBE) === '1';
    localStorage.removeItem(PROBE);
    return ok;
  } catch {
    return false;
  }
}

export function pendingPveVictoryJournal(playerId: string): boolean {
  return readJournal(playerId) !== null;
}

/**
 * Call synchronously BEFORE updating the in-memory player state on victory.
 * Do not replace an unresolved checkpoint with a second victory.
 */
export function stagePveVictoryJournal(playerId: string, snapshot: GameState): boolean {
  if (!playerId || !validEconomySnapshot(snapshot)) return false;
  const existing = readJournal(playerId);
  if (existing === 'invalid') return false;
  if (existing) return sameJson(existing.journal.snapshot, JSON.parse(JSON.stringify(snapshot)));
  const baseRevision = saveTokens.get(playerId);
  if (!validSaveToken(baseRevision)) return false;
  const record: VictoryJournal = {
    version: 1, playerId, baseRevision,
    snapshot: JSON.parse(JSON.stringify(snapshot)) as GameState,
  };
  try {
    const serialized = JSON.stringify(record);
    localStorage.setItem(key(playerId), serialized);
    return localStorage.getItem(key(playerId)) === serialized;
  } catch {
    return false;
  }
}

function clearMatchingJournal(playerId: string, stored: StoredJournal): boolean {
  try {
    if (localStorage.getItem(key(playerId)) !== stored.serialized) return false;
    localStorage.removeItem(key(playerId));
    return localStorage.getItem(key(playerId)) === null;
  } catch {
    return false;
  }
}

/** A boolean ACK from a coalescing save queue alone is not proof of this victory. */
async function serverHasExactVictory(playerId: string, snapshot: GameState): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('players')
      .select('game_state,gold,gems,updated_at').eq('id', playerId).maybeSingle();
    return !error && !!data && validSaveToken(data.updated_at)
      && data.gold === snapshot.player.gold && data.gems === snapshot.player.gems
      && samePersistedVictory(data.game_state, snapshot)
      ? data.updated_at : null;
  } catch {
    return null;
  }
}

/**
 * Save only the previously journaled snapshot, then read back the exact
 * owner-scoped cloud state. Never confirm or delete an unverified checkpoint.
 */
export async function persistPveVictoryJournal(playerId: string, snapshot: GameState): Promise<boolean> {
  const stored = readJournal(playerId);
  if (!stored || stored === 'invalid' || !sameJson(stored.journal.snapshot, JSON.parse(JSON.stringify(snapshot)))) return false;
  // A write may have succeeded just before the browser was killed/ACK was lost.
  const existingRevision = await serverHasExactVictory(playerId, snapshot);
  if (existingRevision) {
    // The network ACK may have vanished after DB commit. Until bootstrap
    // reloads its CAS token, the current session must NOT start a new fight.
    return existingRevision === saveTokens.get(playerId) && clearMatchingJournal(playerId, stored);
  }
  if (!await saveCloudSave(playerId, snapshot)) return false;
  const committedRevision = await serverHasExactVictory(playerId, snapshot);
  if (!committedRevision || committedRevision !== saveTokens.get(playerId)) return false;
  return clearMatchingJournal(playerId, stored);
}

/** Retry the exact journaled win, never an unrelated newer local state. */
export async function retryPveVictoryJournal(playerId: string): Promise<boolean> {
  const stored = readJournal(playerId);
  if (!stored || stored === 'invalid') return false;
  return persistPveVictoryJournal(playerId, stored.journal.snapshot);
}

/**
 * Use a recently authenticated, owner-scoped cloud row only. A revision or
 * wallet mismatch means the row may be stale or incomplete: keep the local WAL
 * in place and refuse automatic continuation.
 */
function verifiedCloudEntry(playerId: string, profile: RecoveryProfile): boolean {
  return !!playerId && validSaveToken(profile.saveRevision)
    && saveTokens.get(playerId) === profile.saveRevision
    && validEconomySnapshot(profile.state)
    && profile.walletGold === profile.state.player.gold
    && profile.walletGems === profile.state.player.gems;
}

/**
 * Runs after authenticated cloud load but BEFORE hydrating useGame or autosaves.
 *
 * Normal path: commit the original exact victory using the guarded CAS writer
 * or confirm its exact cloud receipt. If the cloud row has already advanced
 * independently, or the local WAL cannot be parsed, we cannot safely replay
 * or overwrite its rewards. Archive the original bytes atomically on THIS
 * device, then load the verified cloud hero without a permanent login lock.
 *
 * This recovers ACCESS, not the unconfirmed victory reward. An archive flag
 * must remain visible so the player can request support reconciliation.
 * True network/save errors with an unchanged cloud revision still block.
 */
export async function recoverPveVictoryOnBoot(
  playerId: string,
  profile: RecoveryProfile,
): Promise<{ state: GameState; recovered: boolean; archived?: boolean } | null> {
  const stored = readJournal(playerId);
  if (stored === null) return { state: profile.state, recovered: false };
  if (stored === 'invalid') {
    if (!verifiedCloudEntry(playerId, profile)
      || !archiveUnresolvedPveVictoryForCloudEntry(playerId)) return null;
    return { state: profile.state, recovered: false, archived: true };
  }
  const snapshot = stored.journal.snapshot;
  if (samePersistedVictory(profile.savedGameState, snapshot)
    && profile.walletGold === snapshot.player.gold && profile.walletGems === snapshot.player.gems) {
    if (!clearMatchingJournal(playerId, stored)) return null;
    return { state: profile.state, recovered: true };
  }
  if (profile.saveRevision !== stored.journal.baseRevision) {
    // Only newer cloud snapshots are eligible. An older or unverified
    // revision must never be adopted over a locally recorded victory.
    if (!verifiedCloudEntry(playerId, profile)
      || Date.parse(profile.saveRevision) <= Date.parse(stored.journal.baseRevision)
      || !archiveUnresolvedPveVictoryForCloudEntry(playerId)) return null;
    return { state: profile.state, recovered: false, archived: true };
  }
  // Same CAS token: retry the journaled victory. A transient offline failure
  // may not silently fall back to the pre-victory cloud state.
  if (!await persistPveVictoryJournal(playerId, snapshot)) return null;
  return { state: snapshot, recovered: true };
}
