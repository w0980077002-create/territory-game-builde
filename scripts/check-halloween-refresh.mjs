import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync('src/game/halloweenCompanionRefresh.ts','utf8');
const output = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
let now=0, next=0; const timers=new Map();
const setTimer=(fn,delay)=>{const id=++next;timers.set(id,{fn,at:now+delay});return id;};
const clearTimer=id=>timers.delete(id);
const mod={exports:{}};
vm.runInNewContext(output,{module:mod,exports:mod.exports,setTimeout:setTimer,clearTimeout:clearTimer});
function target(){const listeners=new Map();return {visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n)=>listeners.delete(n),emit:n=>listeners.get(n)?.(),listeners};}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
async function advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();}
let calls=0, installs=0; const win=target(),doc=target();
const state={activeFollowerId:'follower_6',followers:[{id:'follower_6',level:7}]};
const stop=mod.exports.watchPumpkinEntitlement(async()=>++calls===1?{kind:'event_active',retryAfterMs:5000}:{kind:'eligible'},()=>{installs++;},win,doc);
await flush(); assert.equal(calls,1); await advance(4999); assert.equal(calls,1);
await advance(1); assert.equal(calls,2); assert.equal(installs,1);
win.emit('online');doc.emit('visibilitychange');await flush();assert.equal(installs,1);assert.equal(calls,2);
assert.equal(state.activeFollowerId,'follower_6');assert.equal(state.followers[0].level,7);stop();assert.equal(win.listeners.size,0);assert.equal(doc.listeners.size,0);assert.equal(timers.size,0);
let denied=0;const w2=target(),d2=target();const stop2=mod.exports.watchPumpkinEntitlement(async()=>({kind:'ineligible'}),()=>denied++,w2,d2);await flush();assert.equal(denied,0);assert.equal(timers.size,0);stop2();
let attempts=0,delivered=0;const w3=target(),d3=target();const stop3=mod.exports.watchPumpkinEntitlement(async()=>{if(++attempts===1)throw Error('offline');return {kind:'eligible'};},()=>delivered++,w3,d3);await flush();await advance(5000);assert.equal(attempts,2);assert.equal(delivered,1);stop3();
console.log('Halloween refresh PASS: server deadline delay, bounded retry, ineligible, no duplicate installation, cleanup.');
