/** VIP prestige visuals only. Selection is local presentation state:
 * entitlement comes exclusively from verified account / server status.
 * No cosmetic selection mints VIP, items, equipment or combat power. */
export type VipCosmeticCategory = 'frame'|'aura'|'crown'|'crest'|'skin'|'throne';
export type VipCosmetic = {
  id:string;category:VipCosmeticCategory;minVip:number;asset:string;
  ru:string;en:string;
};
export const VIP_COSMETICS:readonly VipCosmetic[] = [
 {id:'frame-1',category:'frame',minVip:1,asset:'cosmetics/frames/frame-1.svg',ru:'Рамка Дозорного',en:'Sentinel frame'},
 {id:'frame-2',category:'frame',minVip:2,asset:'cosmetics/frames/frame-2.svg',ru:'Рамка Воина',en:'Warrior frame'},
 {id:'frame-3',category:'frame',minVip:4,asset:'cosmetics/frames/frame-3.svg',ru:'Рамка Барона',en:'Baron frame'},
 {id:'frame-4',category:'frame',minVip:6,asset:'cosmetics/frames/frame-4.svg',ru:'Рамка Герцога',en:'Duke frame'},
 {id:'frame-5',category:'frame',minVip:8,asset:'cosmetics/frames/frame-5.svg',ru:'Королевская рамка',en:'Royal frame'},
 {id:'frame-6',category:'frame',minVip:10,asset:'cosmetics/frames/frame-6.svg',ru:'Рамка Легенды',en:'Legend frame'},
 {id:'aura-1',category:'aura',minVip:5,asset:'cosmetics/auras/aura-1.svg',ru:'Золотая аура',en:'Golden aura'},
 {id:'aura-2',category:'aura',minVip:7,asset:'cosmetics/auras/aura-2.svg',ru:'Ледяная аура',en:'Frost aura'},
 {id:'aura-3',category:'aura',minVip:9,asset:'cosmetics/auras/aura-3.svg',ru:'Имперская аура',en:'Imperial aura'},
 {id:'crown-1',category:'crown',minVip:5,asset:'cosmetics/crowns/crown-1.svg',ru:'Корона Графа',en:'Count crown'},
 {id:'crown-2',category:'crown',minVip:7,asset:'cosmetics/crowns/crown-2.svg',ru:'Корона Властелина',en:'Overlord crown'},
 {id:'crown-3',category:'crown',minVip:8,asset:'cosmetics/crowns/crown-3.svg',ru:'Королевская корона',en:'Royal crown'},
 {id:'crown-4',category:'crown',minVip:10,asset:'cosmetics/crowns/crown-4.svg',ru:'Корона Легенды',en:'Legend crown'},
 {id:'crest-1',category:'crest',minVip:3,asset:'cosmetics/heraldry/crest-1.svg',ru:'Герб Стража',en:'Guardian crest'},
 {id:'crest-2',category:'crest',minVip:6,asset:'cosmetics/heraldry/crest-2.svg',ru:'Герб Герцога',en:'Duke crest'},
 {id:'crest-3',category:'crest',minVip:8,asset:'cosmetics/heraldry/crest-3.svg',ru:'Королевский герб',en:'Royal crest'},
 {id:'crest-4',category:'crest',minVip:10,asset:'cosmetics/heraldry/crest-4.svg',ru:'Герб Основателя',en:'Founder crest'},
 {id:'hero-vip5',category:'skin',minVip:5,asset:'skins/hero-vip5.svg',ru:'Облик героя: Граф',en:'Count hero skin'},
 {id:'companion-vip7',category:'skin',minVip:7,asset:'skins/companion-vip7.svg',ru:'Облик спутника: Лунный волк',en:'Moon wolf companion skin'},
 {id:'throne-vip10',category:'throne',minVip:10,asset:'cosmetics/throne-vip10.svg',ru:'Легендарный трон',en:'Legend throne'},
] as const;
export function vipArtUrl(asset:string){
  return import.meta.env.BASE_URL+'assets/territory/vip/'+asset;
}
function storageKey(userId:string,category:VipCosmeticCategory){
  return 'territory:vip-cosmetic:v1:'+userId+':'+category;
}
export function activeVipCosmetic(userId:string,category:VipCosmeticCategory,level:number):VipCosmetic|null {
 if(!userId||!Number.isFinite(level))return null;
 try{
  const saved=window.localStorage.getItem(storageKey(userId,category));
  if(!saved)return null;
  return VIP_COSMETICS.find(x=>x.id===saved&&x.category===category&&x.minVip<=level)??null;
 }catch{return null;}
}
export function setVipCosmetic(userId:string,category:VipCosmeticCategory,id:string|null,level:number):boolean{
 if(!userId||!Number.isFinite(level))return false;
 if(id!==null&&!VIP_COSMETICS.some(x=>x.id===id&&x.category===category&&x.minVip<=level))return false;
 try {
  if(id===null)window.localStorage.removeItem(storageKey(userId,category));
  else window.localStorage.setItem(storageKey(userId,category),id);
  window.dispatchEvent(new Event('territory:vip-cosmetics-changed'));
  return true;
 } catch { return false; }
}
