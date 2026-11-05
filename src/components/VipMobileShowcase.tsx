import { useRef, useState } from 'react';
import { ArrowLeft, Crown, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useStore } from '@/game/store';
import { useAccount } from '@/game/actions';
import { useLanguage } from '@/game/i18n';
import { vipTier, VIP_TIERS, vipNextThreshold } from '@/game/vipProgram';
import { VIP_COSMETICS, activeVipCosmetic, setVipCosmetic, vipArtUrl, type VipCosmeticCategory } from '@/game/vipCosmetics';
import { VipStatusPanel } from './VipStatusPanel';

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
 * Actual chest claims live in VipStatusPanel, never in decorative buttons. */
export function VipMobileShowcase({userId,onBack,onEquipment,onRunes,onBelt}:Props){
  const account=useStore(useAccount);
  const {language}=useLanguage();
  const en=language==='en';
  const rewards=useRef<HTMLDivElement>(null);
  const [chosenTier,setChosenTier]=useState<number|null>(null);
  const [cosmeticsCategory,setCosmeticsCategory]=useState<VipCosmeticCategory>('frame');
  const [cosmeticRevision,setCosmeticRevision]=useState(0);
  const remaining=Math.max(0,(account.vipRemaining??0)-(performance.now()-(account.vipCheckedAt??0)));
  const level=Math.min(10,Math.max(0,account.permanentVip??0,remaining>0?account.vip:0));
  const paidLevel=Math.max(0,Math.min(10,account.paidVip??0));
  const spent=Number.isSafeInteger(account.paidSpendCents)?account.paidSpendCents:0;
  const threshold=vipNextThreshold(paidLevel);
  const progress=threshold===null?100:Math.min(100,Math.max(0,Math.floor(spent/100/threshold*100)));
  const preview=vipTier(chosenTier??Math.max(1,level));
  const toRewards=()=>rewards.current?.scrollIntoView({behavior:'smooth',block:'start'});
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
      <div className="relative h-[168px] min-[390px]:h-[196px] bg-[radial-gradient(ellipse_at_50%_15%,#865239_0%,#2d1f1a_64%,#1a1110_100%)]">
        <div className="absolute inset-x-0 top-2 flex items-center justify-center gap-2 text-[11px] font-bold text-[#ffe7b5]">
          <Sparkles size={15} className="text-amber-300"/>{en?'Prestige in TERRITORY':'Слава героя TERRITORY'}
        </div>
        <img src={vipArtUrl('skins/hero-vip5.svg')} alt="" draggable={false}
          className="absolute bottom-0 left-[-4%] h-[145px] w-[61%] object-contain object-bottom min-[390px]:h-[175px]"/>
        <img src={vipArtUrl('skins/companion-vip7.svg')} alt="" draggable={false}
          className="absolute bottom-0 right-[-4%] h-[110px] w-[48%] object-contain object-bottom min-[390px]:h-[132px]"/>
        <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 flex-col items-center">
          <img src={badge(level)} alt="" draggable={false} className="h-[100px] w-[100px] drop-shadow-[0_4px_8px_#000] min-[390px]:h-[116px] min-[390px]:w-[116px]"/>
          <span className="relative -mt-3 rounded-full border border-[#cc8d42] bg-[#2b170f]/90 px-3 py-0.5 text-[11px] font-black text-[#ffdf96]">
            {en?'VIP':'VIP'} {level}{account.giftVip>0&&account.giftVip>=level?' · '+(en?'Gift':'Подарок'):''}
          </span>
        </div>
      </div>
      <div className="space-y-1 border-t-2 border-[#a96b35] bg-[#301c15] px-3 py-2">
        <div className="flex justify-between gap-2 text-[11px] font-semibold text-[#f9dcaa]">
          <span>{en?'Paid-tier progress':'Прогресс покупок'}</span>
          <span>{account.entitlementVerified && threshold!==null
            ? `$${(spent/100).toFixed(2)} / $${threshold}`
            : account.entitlementVerified?(en?'Maximum tier':'Максимальный уровень'):(en?'Not connected':'Пока не подключено')}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full border border-amber-500/40 bg-[#170f0b]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#ac6723] via-[#ffc35a] to-[#fff2a1]" style={{width:`${account.entitlementVerified?progress:0}%`}}/>
        </div>
        <p className="text-[10px] text-amber-100/70">{en?'Gifts never count as purchases.':'Подарочный VIP не считается покупкой.'}</p>
      </div>
    </div>

    <div className={`rounded-xl p-1.5 ${texture}`}>
      <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label={en?'VIP levels':'Уровни VIP'}>
        {VIP_TIERS.slice(1).map(t=><button type="button" key={t.level}
          onClick={()=>setChosenTier(t.level)} aria-pressed={preview.level===t.level}
          className={`flex min-w-[55px] flex-1 shrink-0 flex-col items-center rounded-lg border px-0.5 py-1 ${preview.level===t.level?'border-[#ffdd81] bg-[#875122]':'border-[#9b6c42]/40 bg-black/20'}`}>
          <img src={badge(t.level)} alt="" loading="lazy" draggable={false}
            className={`h-10 w-10 object-contain ${level<t.level?'grayscale opacity-65':''}`}/>
          <span className="text-[10px] font-black text-amber-100">{t.level}</span>
        </button>)}
      </div>
      <p className="px-1 pb-0.5 text-center text-[11px] text-[#ffe3a7]">
        <strong>VIP {preview.level}</strong> · {en?preview.nameEn:preview.nameRu} · {en?'PvE gold / XP':'Золото / опыт PvE'} +{preview.goldXpBonusPercent}%
      </p>
    </div>

    <div className="grid grid-cols-2 gap-2">
      {[{id:'daily',image:dailyChest(level),min:1,title:en?'Daily chest':'Ежедневный сундук'},
        {id:'weekly',image:weeklyChest(level),min:2,title:en?'Weekly chest':'Еженедельный сундук'}].map(chest=>
        <button key={chest.id} type="button" onClick={toRewards}
          className={`relative flex min-h-[138px] flex-col items-center justify-between rounded-xl px-1.5 py-2 text-center ${texture}`}>
          <img src={chest.image} alt="" draggable={false} className="h-[70px] w-full object-contain"/>
          <strong className="text-[11px] leading-tight text-amber-100">{chest.title}</strong>
          <span className="mt-1 w-full rounded-lg border border-amber-200/50 bg-gradient-to-b from-[#ffdc88] to-[#a96d27] px-1 py-1.5 text-[11px] font-black text-[#2a150c]">
            {level<chest.min?<><LockKeyhole className="mr-1 inline h-3 w-3"/>VIP {chest.min}</>:(en?'Go to gift':'К подарку')}
          </span>
        </button>)}
    </div>

    <div className={`rounded-xl p-2 ${texture}`}>
      <div className="mb-2 flex items-center justify-center gap-2 text-center text-base font-black text-[#ffe0a0]"><Crown size={17}/>{en?'VIP benefits':'Преимущества VIP'}</div>
      <div className="grid grid-cols-2 gap-2 min-[390px]:grid-cols-3">
        {featureCards.map(card=>{
          const content=<><img src={`${import.meta.env.BASE_URL}${card.asset}`} alt="" draggable={false} className="h-12 w-12 object-contain"/>
            <strong className="text-[11px] leading-tight text-amber-100">{card.label}</strong>
            <span className="text-[10px] text-[#f7c96f]">{card.value}</span></>;
          const className='flex min-h-[98px] flex-col items-center justify-center gap-1 rounded-lg border border-[#8e582b] bg-[#3c2017] px-1.5 py-2 text-center';
          return card.action?<button type="button" key={card.id} onClick={card.action} className={className}>{content}</button>
            :<div key={card.id} className={className}>{content}</div>;
        })}
      </div>
    </div>

    <div className={`rounded-xl p-2 ${texture}`}>
      <h3 className="mb-2 text-center text-sm font-black text-[#ffdf98]">{en?'VIP decoration':'VIP оформление'}</h3>
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

    <button type="button" onClick={toRewards}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[#fff1b2] bg-gradient-to-b from-[#ffe294] via-[#eaa83e] to-[#a65d18] text-sm font-black text-[#2a140c] shadow-[0_3px_0_#5a3116,inset_0_2px_0_#fff4b6]" data-testid="vip-open-rewards">
      <Crown size={19}/>{en?'VIP gifts and details':'VIP-награды и подробности'}
    </button>
    <div ref={rewards} id="vip-hub-rewards" className="scroll-mt-2" data-testid="vip-real-rewards">
      <VipStatusPanel userId={userId} initialOpen/>
    </div>
  </section>;
}
