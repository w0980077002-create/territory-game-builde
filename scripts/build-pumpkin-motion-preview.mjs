// A small test harness renders the production component; controls are simulated
// and do not claim to prove a real game fight or Telegram WebView.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PumpkinWitch}from'./src/components/PumpkinWitch';function Preview(){const [seq,setSeq]=useState(0);const [pose,setPose]=useState(null);const [attack,setAttack]=useState(0);const [heal,setHeal]=useState(0);const [appear,setAppear]=useState(0);function trigger(kind){const n=seq+1;setSeq(n);if(kind==='appear')setAppear(n);else{setPose({kind,sequence:n});if(kind==='attack')setAttack(n);else setHeal(n)}}return <><div style={{width:260,height:300,overflow:"hidden"}}><PumpkinWitch attack={attack} heal={heal} appear={appear} pose={pose} preloadActions/></div><button onClick={()=>trigger('appear')}>appear</button><button onClick={()=>trigger('attack')}>attack</button><button onClick={()=>trigger('heal')}>heal</button></>};createRoot(document.getElementById('root')).render(<Preview/>);`;
const result=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/pumpkin-motion-fixture',format:'iife',jsx:'automatic',alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'process.env.NODE_ENV':'"production"'}});
const css=result.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-pumpkin-motion.html',`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
