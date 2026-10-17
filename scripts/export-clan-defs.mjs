import fs from 'fs';

const file = process.argv[2];
let raw = fs.readFileSync(file, 'utf8');

let parsed;
const trimmed = raw.trim();
if (trimmed.startsWith('"')) {
  // Whole file is one JSON-encoded string; decode it to get the real payload
  raw = JSON.parse(trimmed);
}
const start = raw.search(/\[\s*\{|\{"defs"/);
if (start === -1) throw new Error('No JSON payload found');
const end = raw.lastIndexOf(']');
let payload = raw.slice(start, end + 1);
try {
  parsed = JSON.parse(payload);
} catch {
  // Payload may itself be double-encoded
  parsed = JSON.parse(JSON.parse(payload));
}

if (!Array.isArray(parsed)) parsed = [parsed];

const defs = parsed.map(x => (typeof x === 'string' ? x : x.defs)).filter(Boolean);

const out = defs
  .map(d =>
    d
      .split('<<SEP>>')
      .map(s => s.replaceAll('<<NL>>', '\n').replaceAll('<<DQ>>', '"').replaceAll('<<BS>>', '\\').trimEnd())
      .join('\n')
  )
  .map(d => (d.trimEnd().endsWith(';') ? d.trimEnd() : d.trimEnd() + ';'))
  .join('\n\n') + '\n';

fs.mkdirSync('supabase/migrations', { recursive: true });
fs.writeFileSync('supabase/migrations/20261017_clans_functions_snapshot.sql', out);
console.log('functions written:', defs.length);
