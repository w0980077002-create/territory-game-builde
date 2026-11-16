// Renderer QA only. Real modules and files under the production Pages prefix;
// no auth, API, player storage, second game runtime or gameplay alternatives.
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
const result=await build({stdin:{contents:`
import {loadImages,render} from './src/components/pve/cavePreview/renderer';
import {createWorld,update,start,choosePortal} from './src/game/cavePreviewWorld/engine';
import {animationState,visualId} from './src/components/pve/cavePreview/actorAnimation';
const controller=new AbortController();
const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');
const images=await loadImages(path=>'/territory-game-builde/'+path,controller.signal);
const w=createWorld();
window.qa={w,images,start,update,choosePortal,animationState,visualId,
 draw(reduced=false,quality='high'){render(c,w,images,480,false,reduced,0,quality)},
 stop(){controller.abort()},
 snapshot(species='eel',floor=21,biome='crystal',id=2){
  Object.assign(w,createWorld(),{floor,biome,phase:'BOSS',phaseAt:0,time:10,heroX:175,cameraX:0,paused:true});
  w.enemies=[{id,species,worldX:species==='boss'?345:285,hp:100,maxHp:100,pose:'idle',poseUntil:10.8,ready:12,impact:0,deathAt:0,lane:1,attacks:0,heavy:false}];
  this.draw();
 }
};qa.snapshot();
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',target:'es2022'});
mkdirSync('artifacts/cave-expedition',{recursive:true});
writeFileSync('artifacts/cave-expedition/animation-fixture.html',`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cave renderer QA</title><style>body{margin:0;background:#07121f}canvas{width:100vw;max-width:430px}</style><canvas width="430" height="480"></canvas><script type="module">${result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></html>`);
console.log('Built animation-fixture.html: real renderer and optional HTTP assets, production Pages prefix.');
