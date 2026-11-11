#!/usr/bin/env node
/** TERRITORY 2026-11-11 — combine two verified art ZIPs into ONE non-live namespace.
 * This is a transport tool, NOT a game integration or animation.
 * Usage: node scripts/import-approved-characters-v2-two-parts.mjs A.zip B.zip [--dry-run]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, dirname, sep } from 'node:path';
const PACKS = [
  {name:'A_heroes_companions_enemies', sha:'7b78a34e2d3e6177fb7b9d9959c7165ec509c8c53ed74c12c69e9bf9bebea8a1'},
  {name:'B_minibosses_bosses_special',sha:'afa1017aca8611af94e1113761a34e7b7dd4cd147d4e5615bb917c808632a8fa'},
];
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const fail = s => {throw new Error(s)};
const [a,b] = process.argv.slice(2).filter(x=>!x.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');
if (!a || !b) fail('Usage: node scripts/import-approved-characters-v2-two-parts.mjs A.zip B.zip [--dry-run]');
function inside(dir,p) {const dst=resolve(dir,p);if(!dst.startsWith(resolve(dir)+sep)) fail('Unsafe path: '+p);return dst;}
function getFiles(dir) {const out=[];for (const ent of readdirSync(dir,{withFileTypes:true})) {const p=join(dir,ent.name);if(ent.isDirectory()) out.push(...getFiles(p)); else if(ent.isFile())out.push(p); else fail('Unexpected link in archive: '+p);}return out;}
const base=mkdtempSync(join(tmpdir(),'territory-v2-two-'));
try {
  const merged=join(base,'merged');mkdirSync(merged);
  const found = new Map();
  for (const [i,pack] of PACKS.entries()) {
    const zip=resolve(i===0?a:b);
    if(!existsSync(zip)) fail('Missing ZIP '+zip);
    if(sha(zip)!==pack.sha)fail('SHA256 mismatch '+pack.name+'; do not import unapproved art');
    const names=execFileSync('unzip',['-Z1',zip],{encoding:'utf8',maxBuffer:2e6}).trim().split('\n').filter(Boolean);
    for(const name of names){if(!name.startsWith(pack.name+'/'))fail('Unexpected top directory: '+name);inside(base,name);}
    const unpack=join(base,'unpacked'+i);mkdirSync(unpack);
    execFileSync('unzip',['-qq',zip,'-d',unpack]);
    const root=join(unpack,pack.name);
    const part=JSON.parse(readFileSync(join(root,'part_manifest.json'),'utf8'));
    if(part.part!==pack.name)fail('Part manifest ID mismatch');
    const actual=getFiles(root).filter(x=>x!==join(root,'part_manifest.json'));
    if (actual.length!==Object.keys(part.files).length)fail('Unexpected file count: '+pack.name);
    for(const p of actual) {
      const rel=relative(root,p).split(sep).join('/');
      if(part.files[rel]!==sha(p))fail('Part manifest mismatch '+rel);
      const dest=inside(merged,rel);
      const sum=sha(p);
      if(found.has(rel)){if(found.get(rel)!==sum)fail('Part conflict: '+rel);continue;}
      found.set(rel,sum);mkdirSync(dirname(dest),{recursive:true});copyFileSync(p,dest);
    }
  }
  if(found.size!==61)fail('Expected 61 original files, got '+found.size);
  const manifest=JSON.parse(readFileSync(join(merged,'manifest.json'),'utf8'));
  const entries=manifest.files;
  if(entries.length!==21)fail('Expected 21 characters, got '+entries.length);
  const owners=new Set();const targets=[];
  for(const e of entries){
    if(!/^[a-z0-9_]+$/.test(e.id)|| !/^(heroes|companions|enemies|minibosses|bosses|special)$/.test(e.category))fail('Invalid character id');
    const png=inside(merged,e.master),webp=inside(merged,e.still_preview);
    if(!existsSync(png)||sha(png)!==e.sha256)fail('Master png hash invalid '+e.id);
    if(readFileSync(png).subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail('Not a PNG '+e.id);
    if(!existsSync(webp)||readFileSync(webp).toString('ascii',0,4)!=='RIFF'||readFileSync(webp).toString('ascii',8,12)!=='WEBP')fail('Not a WebP '+e.id);
    if(e.category==='enemies' && e.expected_facing!=='left')fail('Enemy orientation metadata invalid '+e.id);
    const cat=e.category,id=e.id;
    targets.push([png,`docs/art-reference/approved-characters-20261111/${cat}/${id}.png`]);
    targets.push([webp,`public/assets/territory/cave-expedition/characters-v2/${cat}/${id}/idle-still.webp`]);
    owners.add(e.owner_reference);
  }
  for(const name of [...owners,'1000088545.png']){
    const src=inside(merged,'03_original_owner_references/'+name);
    if(!existsSync(src))fail('Missing original '+name);
    targets.push([src,'docs/art-reference/approved-characters-20261111/originals/'+name]);
  }
  targets.push([join(merged,'manifest.json'),'docs/art-reference/approved-characters-20261111/manifest.json']);
  for(const [src,dst] of targets){if(!existsSync(src))fail('Missing asset '+src);if(existsSync(dst))fail('Refusing to overwrite '+dst);}
  console.log(`VERIFIED ${found.size} original files, ${entries.length} RGBA PNG masters and WebP stills, ${owners.size+1} owner references; staging files=${targets.length}`);
  if(!dryRun){for(const [src,dst] of targets){mkdirSync(dirname(dst),{recursive:true});copyFileSync(src,dst)}console.log('IMPORTED: staging ONLY. No existing live game assets replaced.');}
  else console.log('DRY RUN: no game/repository files changed.');
}finally{rmSync(base,{recursive:true,force:true})}