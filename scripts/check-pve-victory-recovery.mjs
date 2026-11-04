import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const oldRevision = '2026-11-04T06:00:00.000Z';
const newRevision = '2026-11-04T06:01:00.000Z';
const memory = new Map();
globalThis.localStorage = {
  getItem: k => memory.has(k) ? memory.get(k) : null,
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: k => memory.delete(k),
};
globalThis.__server = { revision: oldRevision, state: { player: { gold: 10, gems: 2 }, chapterWins: 0 }, gold: 10, gems: 2 };
globalThis.__writes = 0;
globalThis.__cloudMode = 'normal';
globalThis.__readFailure = false;

const mocked = {
  './cloud': String.raw