/* Territory Game — CANONICAL PvE FLOW
   Pass 04: reference-driven battle presentation.
   Rules preserved from BATTLE_FLOW_10039/10040: 4 normal wins = 100%,
   auto continues to the next normal encounter, boss is manual via skull,
   Arena remains separate. */
(function(){
  'use strict';
  const S=()=>window.TerritoryStore?.state||{};
  const save=()=>window.TerritoryStore?.saveNow?.('pve-flow');
  let map=null;
  function ensure(){
    const s=S();s.pve=s.pve||{chapter:s.currentChapter||1,stage:s.chapterStage||1,progress:s.chapterProgress||0,bossPending:false,bossActive:false,bossDefeated:0};
    s.currentChapter=Math.max(1,Math.min(240,Number(s.currentChapter||s.pve.chapter)||1));
    s.pve.chapter=s.currentChapter;s.pve.progress=Math.max(0,Math.min(100,Number(s.pve.progress)||0));
    s.pve.stage=Math.max(1,Math.min(4,Number(s.pve.stage)||Math.floor(s.pve.progress/25)+1));s.chapterStage=s.pve.stage;s.chapterProgress=s.pve.progress;s.pve.bossPending=!!(s.pve.bossPending||s.pve.progress>=100);s.chapterBossUnlocked=s.pve.bossPending;return s;
  }
  function mount(){if(map)return map;map=document.createElement('div');map.id='pveFlowOverlay';map.className='pve-flow-overlay';map.innerHTML='<div class="pve-flow-sheet"><header><div><small id="pveChapter"></small><h2>ПУТЬ БОЯ</h2></div><button id="pveClose">×</button></header><div class="pve-track" id="pveTrack"></div><div class="pve-status" id="pveStatus"></div><div class="pve-milestone" id="pveMilestone"></div><div class="pve-actions"><button id="pveStart">⚔️ НАЧАТЬ</button><button id="pveBoss" hidden>☠️ БОСС</button></div></div>';document.body.appendChild(map);map.querySelector('#pveClose').onclick=close;map.querySelector('#pveStart').onclick=startRunner;map.querySelector('#pveBoss').onclick=openBoss;return map}
  function render(){const s=ensure();mount();map.classList.add('show');map.querySelector('#pveChapter').textContent=`ГЛАВА ${s.currentChapter} / 240`;const tr=map.querySelector('#pveTrack');tr.innerHTML='';for(let i=1;i<=4;i++){const n=document.createElement('div');n.className='pve-node '+(s.pve.progress>=i*25?'done':'')+(s.pve.progress<i*25?' current':'');n.textContent=s.pve.progress>=i*25?'✓':i;tr.appendChild(n)}map.querySelector('#pveStatus').textContent=`Прогресс: ${s.pve.progress}% · Этап ${Math.min(4,Math.floor(s.pve.progress/25)+1)}`;const m=map.querySelector('#pveMilestone');const next=Math.min(240,Math.floor((s.currentChapter-1)/10+1)*10);m.textContent=`🏆 Ближайшая награда: глава ${next} · ${next===s.currentChapter?'особый бонус доступен сейчас':'большая награда каждые 10 глав'}`;map.querySelector('#pveStart').disabled=s.pve.progress>=100;map.querySelector('#pveBoss').hidden=!s.pve.bossPending}
  function close(){map?.classList.remove('show');window.showScreen?.('home')}
  function startRunner(){const s=ensure();map?.classList.remove('show');if(s.pve.progress>=100)return;window.PvEBattle?.start?.(s.pve.stage)}
  function openBoss(){const s=ensure();if(!s.pve.bossPending){window.alert?.('☠️ Босс станет доступен после 4 побед.');return}map?.classList.remove('show');window.PvEBattle?.startBoss?.()}
  function open(){render()}
  function start(){startRunner()}
  window.PvEFlow={open,start,startRunner,openBoss,stop:()=>window.PvEBattle?.close?.(),api:()=>null};
  window.HomeRebuild=window.HomeRebuild||{};window.HomeRebuild.startRunner=window.PvEFlow.startRunner;window.HomeRebuild.openBoss=window.PvEFlow.openBoss;
})();
