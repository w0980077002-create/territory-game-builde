// Build a review artifact only. Refuse production credentials and implicit .env.local fallback.
import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,rmSync,writeFileSync} from 'node:fs';
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_ANON_KEY;
const forbidden=['wmyrdpbwlkzsktnhookx.supabase.co','ksikzkrvuuhermhnbycn.supabase.co'];
if(!url||!key)throw new Error('Provide explicit STAGING VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. No .env.local fallback.');
const parsed=new URL(url);
if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co')||forbidden.includes(parsed.hostname))throw new Error('A separate Supabase test project is required; known existing projects are refused.');
if(key.startsWith('sb_secret_'))throw new Error('Secret keys must never be included in the client.');
if(!key.startsWith('sb_publishable_')){
 let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{throw new Error('Expected a publishable or anon client key.');}
 if(claims.role!=='anon'||claims.ref!==parsed.hostname.split('.')[0])throw new Error('Client key must be anon and belong to the selected staging project.');
}
const result=spawnSync('npm',['run','build'],{stdio:'inherit',env:process.env});
if(result.status!==0)process.exit(result.status??1);
rmSync('dist-monopoly-test',{recursive:true,force:true});
mkdirSync('dist-monopoly-test/territory-game-builde',{recursive:true});
cpSync('dist','dist-monopoly-test/territory-game-builde',{recursive:true});
writeFileSync('dist-monopoly-test/index.html','<!doctype html><html lang="ru"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./territory-game-builde/"><a href="./territory-game-builde/">Открыть тест TERRITORY</a></html>');
console.log('Created dist-monopoly-test for a separate HTTPS test site. Nothing deployed.');
