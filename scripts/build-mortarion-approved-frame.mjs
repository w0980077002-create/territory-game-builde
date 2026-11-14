// Reassemble the owner's approved transparent illustration from
// repository-stored chunks. Produced binary stays self-hosted on Pages.
// No Supabase contact and no changes to player state.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const APPROVED_MORTARION_ASSET = 'public/assets/territory/ui/honors/mortarion-lord-approved.avif';
export const APPROVED_MORTARION_SHA256 = '7830e264d961ba609d62f87fbee9b80258e34600f52ca1a15955a38f1b936624';

const chunks = [1, 2, 3].map(n =>
  readFileSync(resolve('scripts/assets/mortarion-lord-approved.'+n+'.b64'), 'utf8').trim());
if (chunks[0].length !== 5000 || chunks[1].length !== 5000 || chunks[2].length !== 4384)
  throw new Error('mortarion_approved_art_incomplete');

const bytes = Buffer.from(chunks.join(''), 'base64');
const sha = createHash('sha256').update(bytes).digest('hex');
if (sha !== APPROVED_MORTARION_SHA256 || bytes.length !== 10787)
  throw new Error('mortarion_approved_art_corrupted:'+sha);

if (bytes.toString('ascii', 4, 8) !== 'ftyp' || bytes.toString('ascii', 8, 12) !== 'avif')
  throw new Error('mortarion_approved_art_not_avif');

const file = resolve(APPROVED_MORTARION_ASSET);
mkdirSync(resolve('public/assets/territory/ui/honors'), { recursive:true });
writeFileSync(file, bytes);
console.log('Approved transparent Mortarion TOP-1 art built: '+bytes.length+' bytes, sha256 '+sha);
