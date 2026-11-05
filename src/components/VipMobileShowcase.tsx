import { useState } from 'react';
import { ArrowLeft, Crown, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useStore } from '@/game/store';
import { useAccount, useGame } from '@/game/actions';
import { getAppearanceIcon } from '@/game/appearance';
import { useLanguage } from '@/game/i18n';
import { vipTier, VIP_TIERS } from '@/game/vipProgram';
import { VIP_COSMETICS, activeVipCosmetic, setVipCosmetic, vipArtUrl, type VipCosmeticCategory } from '@/game/vipCosmetics';


const base = `${import.meta.env.BASE_URL}assets/territory/vip/`;
const badge = (level:number) => base + 'badges/vip-' + String(Math.max(1,Math.min(10,level))).padStart(2,'0') + '.svg';
const dailyChest = (level:number) => base + 'chests/daily-' + Math.max(1,Math.min(5,Math.ceil(Math.max(1,level)/2))) + '.svg';
const weeklyChest = (level:number) => base + 'chests/weekly-' + (level<=3?1:level<=5?2:level===6?3:level<=8?4:5) + '.svg';

type Props = {
  userId:string;
  onBack:()=>void;
  onEquipment:()=>void;
  onRunes:()=>void;
  onBelt:()=>void;
};

const texture='border border-[#a86c36] bg-[linear-gradient(135deg,#6b3822_0%,#3b2119_42%,#231611_100%)] shadow-[inset_0_2px_0_#d1a05b50,0_5px_12px_#11080499]';

/** Player-facing VIP screen. Every picture is its own transparent-background
 * asset inside public/assets/territory/vip (no sprite-sheet crop).
 * Visual-only checkout and chest claim buttons remain disabled until their server entitlement RPC is released. */
export function VipMobileShowcase({userId,onBack,onEquipment,onRunes,onBelt}:Props){
  const account=useStore(useAccount);
  const game=useStore(useGame);
  const {language}=useLanguage();
  const en=language==='en';
  const [selectedChest,setSelectedChest]=useState<'daily'|'weekly'|null>(null);
  const [chosenTier,setChosenTier]=useState<number|null>(null);
  const [cosmeticsCategory,setCosmeticsCategory]=useState<VipCosmeticCategory>('frame');
  const [cosmeticRevision,setCosmeticRevision]=useState(0);
  const remaining=Math.max(0,(account.vipRemaining??0)-(performance.now()-(account.vipCheckedAt??0)));
  const level=Math.min(10,Math.max(0,account.permanentVip??0,remaining>0?account.vip:0));

  const current=vipTier(level);
  const preview=vipTier(chosenTier??Math.max(1,level));
  const toRewards=()=>setSelectedChest(prev=>prev==='daily' ? null : 'daily');
  const selectedCosmetic=activeVipCosmetic(userId,cosmeticsCategory,level);
  const cosmetics=VIP_COSMETICS.filter(item=>item.category===cosmeticsCategory);
  const featureCards=[
    {id:'gold',asset:'assets/territory/vip/perks/gold.svg',label:en?'Gold bonus':'Бонус золота',value:`+${level*2}%`,action:null},
    {id:'xp',asset:'assets/territory/vip/perks/experience.svg',label:en?'Experience bonus':'Бонус опыта',value:`+${level*2}%`,action:null},
    {id:'belt',asset:'assets/territory/vip/perks/belt.svg',label:en?'Smart belt':'Умный пояс',value:level>=3?'VIP 3+':'VIP 3',action:onBelt},
    {id:'gear',asset:'assets/territory/vip/perks/equipment.svg',label:en?'Equipment sets':'Пресеты вещей',value:level>=4?'VIP 4+':'VIP 4',action:onEquipment},
    {id:'runes',asset:'assets/territory/vip/perks/runes.svg',label:en?'Rune sets':'Пресеты рун',value:level>=3?'VIP 3+':'VIP 3',action:onRunes},
    {id:'awards',asset:'assets/territory/vip/perks/rewards.svg',label:en?'VIP rewards':'VIP награды',value:en?'Chests':'Сундуки',action:toRewards},
  ];
  return <section className="territory-vip-mobile animate-fade-in space-y-2 pb-5" data-testid="vip-mobile-showcase" aria-label={en?'VIP status':'VIP статус'}>
    <header className={`relative flex min-h-12 items-center gap-2 rounded-xl px-2 ${texture}`}>
      <button type="button" onClick={onBack} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-amber-400/40 bg-[#2d1c16] text-[#f9dba5]" aria-label={en?'Back to hero':'Назад к герою'}>
        <ArrowLeft size={20}/>
      </button>
      <h2 className="flex-1 text-center text-lg font-black tracking-wide text-[#ffdc93] [text-shadow:0_2px_2px_#1b0b05]">{en?'VIP status':'VIP статус'}</h2>
      <Crown size={22} className="text-amber-300"/>
    </header>

    <div className={`relative overflow-hidden rounded-2xl ${texture}`}>
      <div className="relative grid h-[164px] grid-cols-[46%_54%] overflow-hidden bg-[radial-gradient(ellipse_at_35%_20%,#75422b_0%,#39231d_58%,#231710_100%)] min-[390px]:h-[180px]">
        <div className="absolute inset-0 opacity-15" style={{backgroundImage:"url(" + import.meta.env.BASE_URL + "assets/territory/ui/wooden-plaque.webp)", backgroundSize:"cover", backgroundPosition:"center"}} />
        <div className="relative min-w-0">
          <img src={getAppearanceIcon(game.appearance)} alt="" draggable={false} data-testid="vip-real-hero-art" className="absolute bottom-[-4px] left-0 h-[160px] w-full object-contain object-bottom drop-shadow-[0_6px_7px_#120b09] min-[390px]:h-[177px]"/>
        </div>
        <div className="relative flex min-w-0 flex-col items-center justify-center pr-2 text-center">
          <span className="text-[10px] font-bold text-amber-200/90">TERRITORY VIP</span>
          <img src={badge(level)} alt="" draggable={false} className="mt-1 h-20 w-20 object-contain drop-shadow-[0_4px_6px_#100908]" />
          <strong className="text-lg font-black leading-tight text-[#ffe2ab]">VIP {level}</strong>
          <span className="truncate text-[11px] text-amber-100">{en?current.nameEn:current.nameRu}</span>
        </div>
      </div>
      <div className="flex min-h-10 items-center justify-between gap-2 border-t border-[#96643d] bg-[#301c15] px-3 text-[11px] text-amber-100">
        <span>{en?"Next VIP rank":"Следующий ранг"}</span>
        <strong className="text-[#ffe0a4]">{level>=10?"VIP 10":`VIP ${level+1}`}</strong>
      </div>
    </div>

    <div className={`rounded-xl p-1.5 ${texture}`}>
      <div className="grid grid-cols-5 gap-1" role="group" aria-label={en?'VIP levels':'Уровни VIP'}>
        {VIP_TIERS.slice(1).map(t=><button type="button" key={t.level}
          onClick={()=>setChosenTier(t.level)} aria-pressed={preview.level===t.level}
          className={`flex min-w-0 min-h-[56px] flex-col items-center justify-center rounded-md border px-0.5 py-0.5 ${preview.level===t.level?'border-[#ffdd81] bg-[#875122]':'border-[#9b6c42]/40 bg-black/20'}`}>
          <img src={badge(t.level)} alt="" loading="lazy" draggable={false}
            className={`h-8 w-8 object-contain`}/>
          <span className="text-[10px] font-black text-amber-100">{t.level}</span>
        </button>)}
      </div>
      <p className="px-1 pb-0.5 text-center text-[11px] text-[#ffe3a7]">
        <strong>VIP {preview.level}</strong> · {en?preview.nameEn:preview.nameRu} · {en?'PvE gold / XP':'Золото / опыт PvE'} +{preview.goldXpBonusPercent}%
      </p>
    </div>

    <div className="grid grid-cols-2 gap-2">
      {[{id:'daily' as const,image:dailyChest(level),min:1,title:en?'Daily chest':'Ежедневный сундук'},
        {id:'weekly' as const,image:weeklyChest(level),min:2,title:en?'Weekly chest':'Еженедельный сундук'}].map(chest=>
        <button key={chest.id} type="button" aria-expanded={selectedChest===chest.id}
          onClick={()=>setSelectedChest(prev=>prev===chest.id?null:chest.id)}
          className={`relative flex min-h-[110px] flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-center ${texture}`}>
          <img src={chest.image} alt="" draggable={false} className="h-[55px] w-full object-contain"/>
          <strong className="text-[11px] leading-tight text-amber-100">{chest.title}</strong>
          <span className="flex items-center justify-center gap-1 text-[10px] font-semibold text-amber-200/90">
            {level<chest.min?<><LockKeyhole className="mr-1 inline h-3 w-3"/>VIP {chest.min}</>:(en?'Details':'Подробнее')}
          </span>
        </button>)}
    </div>

    {selectedChest && <p role="status" className="rounded-lg border border-amber-500/35 bg-[#302018] px-3 py-2 text-center text-[11px] text-amber-100">
      {selectedChest==='daily'
        ?(en?'Daily chest requires VIP 1. Claims will be available after release.':'Ежедневный сундук с VIP 1. Получение откроется после запуска.')
        :(en?'Weekly chest requires VIP 2. Claims will be available after release.':'Недельный сундук с VIP 2. Получение откроется после запуска.')}
    </p>}
    <div className={`rounded-xl p-2 ${texture}`}>
      <div className="mb-2 flex items-center justify-center gap-2 text-center text-base font-black text-[#ffe0a0]"><Crown size={17}/>{en?'VIP benefits':'Преимущества VIP'}</div>
      <div className="grid grid-cols-2 gap-1.5 min-[390px]:grid-cols-3">
        {featureCards.map(card=>{
          const content=<><img src={`${import.meta.env.BASE_URL}${card.asset}`} alt="" draggable={false} className="h-9 w-9 shrink-0 object-contain"/>
            <strong className="text-[11px] leading-tight text-amber-100">{card.label}</strong>
            <span className="text-[10px] text-[#f7c96f]">{card.value}</span></>;
          const className='flex min-h-[66px] min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#8e582b] bg-[#2f1c15] px-1.5 py-1 text-center';
          return card.action?<button type="button" key={card.id} onClick={card.action} className={className}>{content}</button>
            :<div key={card.id} className={className}>{content}</div>;
        })}
      </div>
    </div>

    <details className={`group rounded-xl p-2 ${texture}`} data-testid="vip-cosmetic-gallery">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-1 text-sm font-black text-[#ffdf98]">
        <span>{en?'VIP decoration':'VIP оформление'}</span>
        <span className="text-[11px] text-amber-100/80">{en?'Open gallery':'Посмотреть'} ▾</span>
      </summary>
      <div className="mt-1 border-t border-amber-700/30 pt-2">
      <div className="flex gap-1 overflow-x-auto pb-2">
        {(['frame','aura','crown','crest','skin','throne'] as const).map(category=>
          <button key={category} type="button" aria-pressed={cosmeticsCategory===category}
            onClick={()=>setCosmeticsCategory(category)}
            className={`min-h-9 shrink-0 rounded-md border px-2 text-[10px] font-bold ${cosmeticsCategory===category?'border-amber-200 bg-[#8e5829] text-white':'border-amber-500/30 bg-[#28160f] text-amber-200'}`}>
            {({frame:en?'Frames':'Рамки',aura:en?'Auras':'Ауры',crown:en?'Crowns':'Короны',
              crest:en?'Crests':'Гербы',skin:en?'Skins':'Облики',throne:en?'Throne':'Трон'})[category]}
          </button>)}
      </div>
      <div className="grid grid-cols-3 gap-1.5" key={cosmeticsCategory+'-'+cosmeticRevision}>
        {cosmetics.map(item=>{
          const unlocked=level>=item.minVip;
          const selected=selectedCosmetic?.id===item.id;
          return <button key={item.id} type="button" disabled={!unlocked}
            onClick={()=>{
              if(setVipCosmetic(userId,item.category,selected?null:item.id,level))
                setCosmeticRevision(x=>x+1);
            }}
            className={`relative flex min-h-[112px] flex-col items-center justify-center gap-1 rounded-lg border px-1 py-1.5 ${selected?'border-amber-200 bg-amber-500/20':'border-[#7d4d28] bg-[#271712]'} disabled:opacity-50`}>
            {!unlocked&&<LockKeyhole className="absolute right-1 top-1 h-3.5 w-3.5 text-[#ffdd97]"/>}
            {selected&&<ShieldCheck className="absolute right-1 top-1 h-3.5 w-3.5 text-emerald-300"/>}
            <img src={vipArtUrl(item.asset)} alt="" draggable={false} loading="lazy" className="h-[65px] w-full object-contain"/>
            <span className="text-[10px] leading-tight text-amber-100">{en?item.en:item.ru}</span>
            {!unlocked&&<span className="text-[9px] text-[#f6d28e]">VIP {item.minVip}</span>}
          </button>;
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-amber-100/60">
        {en?'Cosmetic selection is local; it does not add combat power.':'Выбор оформления не добавляет боевой силы.'}
      </p>
    </div>

    </details>
    <p className="px-2 pb-2 text-center text-[10px] text-amber-100/65" data-testid="vip-preview-not-live">
      <ShieldCheck size={12} className="mr-1 inline text-amber-300"/>
      {en?"Visual preview only: VIP rewards and purchases are not live."
        :"Оформление для просмотра. Начисления VIP и покупки пока выключены."}
    </p>
  </section>;
}
