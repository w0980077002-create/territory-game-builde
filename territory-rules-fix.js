(function(){
'use strict';
const S=window.TerritoryStore;if(!S)return;
const KEY='territory_stone_history_v1';
function day(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function protect(){const s=S.state;if(!s)return;let old=null;try{old=JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){}
 const today=day();
 if(!old){try{localStorage.setItem(KEY,JSON.stringify({date:today,stones:Number(s.battleStones)||0,bonus:Number(s.battleStonesBonus)||0}))}catch(_){}return}
 if(old.date!==today){s.battleStones=Math.max(0,Number(old.stones)||0);s.battleStonesBonus=Math.max(0,Number(old.bonus)||0);s.battleStonesDate=today;S.saveNow?.();}
 try{localStorage.setItem(KEY,JSON.stringify({date:today,stones:Number(s.battleStones)||0,bonus:Number(s.battleStonesBonus)||0}))}catch(_){}
}
const oldSave=S.saveNow;S.saveNow=function(){const r=oldSave.apply(this,arguments);try{localStorage.setItem(KEY,JSON.stringify({date:day(),stones:Number(S.state.battleStones)||0,bonus:Number(S.state.battleStonesBonus)||0}))}catch(_){}return r};
protect();
})();
