import { useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Crown, Sparkles, LockKeyhole, ShieldCheck, Check, Gift } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame, useAccount } from '@/game/actions';
import { useLanguage } from '@/game/i18n';
import { getAppearanceIcon } from '@/game/appearance';
import { VIP_TIERS, vipTier } from '@/game/vipProgram';
import { VIP_COSMETICS, activeVipCosmetic, setVipCosmetic, vipArtUrl, type VipCosmeticCategory } from '@/game/vipCosmetics';
import { WoodenPlaque } from '@/components/ui/WoodenPlaque';
import './vipTerritory.css';

const root = import.meta.env.BASE_URL;
const vipRoot = root + 'assets/territory/vip/';
const emblem = (n:number) => vipRoot + 'badges/vip-' + String(n).padStart(2,'0') + '.svg';
const chestArt = (kind:'daily'|'weekly',level:number) => vipRoot+'chests/' +
  (kind==='daily'?'daily-'+Math.min(5,Math.ceil(level/2)):
    'weekly-'+(level<=3?1:level<=5?2:level===6?3:level<=8?4:5)) + '.svg';
const plannedPrices = [0,1,10,100,300,500,1000,3000,5000,8000,10000] as const;
type Mode = 'benefits'|'tryon'|'chests';
type Tab = Exclude<VipCosmeticCategory,'frame'>;
const tabs:readonly Tab[]=['crown','aura','crest','skin','throne'];
const tabLabels:Record<Tab,{ru:string;en:string;symbol:string}>={
  crown:{ru:'Корона',en:'Crown',symbol:'♛'},
  aura:{ru:'Аура',en:'Aura',symbol:'✧'},
  crest:{ru:'Герб',en:'Crest',symbol:'♜'},
  skin:{ru:'Облик',en:'Skin',symbol:'⚔'},
  throne:{ru:'Трон',en:'Throne',symbol:'♔'},
};
const tierName=(n:number,en:boolean)=>n===10?(en?'Founder':'Основатель'):
  n===5?(en?'Duke':'Герцог'):(en?vipTier(n).nameEn:vipTier(n).nameRu);
type Props={userId:string;onBack:()=>void;backToCity?:boolean;
  onEquipment:()=>void;onRunes:()=>void;onBelt:()=>void};

/** Player-visible VIP mockup. Changing a preview tier never grants entitlements, rewards or payments. */
export function VipMobileShowcase({userId,onBack,backToCity=false,onRunes,onBelt}:Props){
  const game=useStore(useGame);
  const account=useStore(useAccount);
  const {language}=useLanguage();
  const en=language==='en';
  const remaining=Math.max(0,(account.vipRemaining??0)-(performance.now()-(account.vipCheckedAt??0)));
  const realVip=Math.min(10,Math.max(0,account.permanentVip??0,remaining>0?account.vip:0));
  const [chosen,setChosen]=useState<number|null>(null);
  const tier=chosen??Math.max(1,realVip);
  const [mode,setMode]=useState<Mode>('benefits');
  const [tab,setTab]=useState<Tab>('crown');
  const [cosmeticIndex,setCosmeticIndex]=useState(0);
  const [revision,setRevision]=useState(0);
  const [chest,setChest]=useState<'daily'|'weekly'|null>(null);
  const [chestOpened,setChestOpened]=useState(false);
  const cosmetics=VIP_COSMETICS.filter(item=>item.category===tab)
    .sort((a,b)=>Number(b.minVip<=tier)-Number(a.minVip<=tier)||b.minVip-a.minVip);
  const cosmetic=cosmetics[cosmeticIndex%Math.max(1,cosmetics.length)]??null;
  // Show the actual hero OR one complete skin, never two overlaid characters.
  const previewSkin=mode==='tryon'&&tab==='skin'?cosmetic:null;
  const previewCrest=mode==='tryon'&&tab==='crest'?cosmetic:null;
  const previewThrone=mode==='tryon'&&tab==='throne'?cosmetic?.asset:
    mode==='benefits'&&tier===10?'cosmetics/throne-vip10.svg':null;
  const previewAura=mode==='tryon'?tab==='aura':tier>=5;
  const crown=mode==='tryon'?(tab==='crown'?cosmetic:null):
    VIP_COSMETICS.filter(x=>x.category==='crown'&&x.minVip<=tier).sort((a,b)=>b.minVip-a.minVip)[0];
  const equipped=Boolean(cosmetic&&activeVipCosmetic(userId,tab,realVip)?.id===cosmetic.id);
  const eligible=Boolean(cosmetic&&cosmetic.minVip<=realVip);
  const changeTier=(n:number)=>{setChosen(n);setCosmeticIndex(0);setChest(null);
    setMode(n>=5?'tryon':'benefits');};
  const changeTab=(next:Tab)=>{setTab(next);setCosmeticIndex(0);setMode('tryon');};
  const openChest=(kind:'daily'|'weekly')=>{setChest(kind);setChestOpened(false);};
  const equip=()=>{
    if(!cosmetic||!eligible)return;
    if(setVipCosmetic(userId,tab,equipped?null:cosmetic.id,realVip))setRevision(n=>n+1);
  };
  void revision;

  return <section className={'territory-vip-mobile territory-vip-rebuild vip-prestige-'+
    (tier>=10?'legend':tier>=5?'duke':'initiate')}
    data-testid="vip-mobile-showcase" aria-label={en?'VIP Hall':'Зал VIP'}>
    <div className="vip-world-bg" aria-hidden="true"/>
    <header className="vip-main-heading">
      <button type="button" className="vip-back-button" onClick={onBack}
        aria-label={backToCity?(en?'Back to city':'Назад в город'):(en?'Back to hero':'Назад к герою')}>
        <ArrowLeft size={21}/>
      </button>
      <WoodenPlaque variant="section">{en?'VIP HALL':'ЗАЛ VIP'}</WoodenPlaque>
      <Crown size={23} className="vip-top-crown"/>
    </header>

    <div className="vip-tier-panel vip-carved-panel">
      <div className="vip-tier-grid" role="group" aria-label={en?'VIP levels':'Уровни VIP'}>
        {VIP_TIERS.slice(1).map(t=><button key={t.level} type="button"
          onClick={()=>changeTier(t.level)} aria-label={'VIP '+t.level} aria-pressed={tier===t.level}
          className={'vip-tier-button '+(t.level===5||t.level===10?'vip-tier-milestone':'')}>
          <img src={emblem(t.level)} alt="" draggable={false}/>
          <strong>{t.level}</strong>
        </button>)}
      </div>
      <div className="vip-tier-bottom">
        <strong>VIP {tier} · {tierName(tier,en)}</strong>
        <small>{en?'Planned price':'Плановая цена'}: {'$'}{plannedPrices[tier]} · {en?'Preview':'Просмотр'}</small>
      </div>
    </div>

    <div className="vip-hero-panel vip-carved-panel">
      <div className={'vip-stage'+(previewSkin?' vip-stage-skin':'')}
        data-testid="vip-stage-transformation" data-vip-subject={previewSkin?.id==='companion-vip7'?'companion':'hero'}>
        <div className="vip-stage-title"><Sparkles size={14}/>
          {tier===10?(en?'FOUNDER LEGEND':'ЛЕГЕНДА TERRITORY')
            :tier>=5?(en?'THE POWER OF VIP':'СИЛА VIP')
            :(en?'PATH TO LEGEND':'ПУТЬ К ЛЕГЕНДЕ')}
        </div>
        {previewThrone&&<img className="vip-prestige-throne" src={vipArtUrl(previewThrone)} alt="" draggable={false}/>}
        {previewAura&&<span className="vip-aura-effect" aria-hidden="true"/>}
        <img className="vip-actual-hero" data-testid="vip-stage-art"
          src={previewSkin?vipArtUrl(previewSkin.asset):getAppearanceIcon(game.appearance)}
          alt={previewSkin?(en?previewSkin.en:previewSkin.ru):(en?'Your hero':'Ваш герой')}
          draggable={false}/>
        {crown&&!previewSkin&&<img className="vip-crown-on-hero" src={vipArtUrl(crown.asset)} alt="" draggable={false}/>}
        {previewCrest&&<img className="vip-stage-crest" src={vipArtUrl(previewCrest.asset)} alt="" draggable={false}/>}
        <div className="vip-stage-emblem">
          <div className="vip-emblem-glow"><img src={emblem(tier)} alt="" draggable={false}/></div>
          <strong>VIP {tier}</strong>
        </div>
      </div>
      <div className="vip-hero-caption">
        <strong>VIP {tier} · {tierName(tier,en)}</strong>
        <span data-testid="vip-owner-test-info">{en?'Your VIP':'Ваш VIP'}: {realVip} · {en?'Previewing':'Смотрите'} VIP {tier}</span>
      </div>
    </div>

    <nav className="vip-content-tabs" aria-label={en?'VIP sections':'Разделы VIP'}>
      <button type="button" aria-pressed={mode==='benefits'} onClick={()=>setMode('benefits')}>{en?'Benefits':'Привилегии'}</button>
      <button type="button" aria-pressed={mode==='tryon'} onClick={()=>setMode('tryon')}>{en?'Try-on':'Примерка'}</button>
      <button type="button" aria-pressed={mode==='chests'} onClick={()=>setMode('chests')}>{en?'Chests':'Сундуки'}</button>
    </nav>

    {mode==='benefits'&&<div className="vip-carved-panel vip-content-panel" data-testid="vip-benefits">
      <h3 className="vip-section-title"><Crown size={18}/>{tier>=10?(en?'Legendary privileges':'Легендарные привилегии')
        :tier>=5?(en?'VIP privileges':'Что открывает VIP '+tier)
        :(en?'Main benefits':'Главные преимущества')}</h3>
      <div className="vip-benefits-grid">
        {(tier>=10?[
          {img:vipArtUrl('cosmetics/crowns/crown-4.svg'),ru:'Корона Основателя',en:'Founder crown',cat:'crown' as Tab},
          {img:vipArtUrl('cosmetics/throne-vip10.svg'),ru:'Королевский трон',en:'Royal throne',cat:'throne' as Tab},
          {img:vipArtUrl('cosmetics/heraldry/crest-4.svg'),ru:'Личный герб',en:'Personal crest',cat:'crest' as Tab},
          {img:root+'assets/territory/ui/shop/plate-armor.webp',ru:'Эпический облик',en:'Epic skin',cat:'skin' as Tab},
          {img:chestArt('daily',tier),ru:'Премиум сундук',en:'Premium chest',cat:null},
        ]:tier>=5?[
          {img:vipArtUrl('cosmetics/crowns/crown-1.svg'),ru:'Элитная корона',en:'Elite crown',cat:'crown' as Tab},
          {img:vipArtUrl('cosmetics/auras/aura-1.svg'),ru:'Золотая аура',en:'Golden aura',cat:'aura' as Tab},
          {img:chestArt('daily',tier),ru:'Расширенный сундук',en:'Special chest',cat:null},
          {img:vipArtUrl('cosmetics/heraldry/crest-2.svg'),ru:'Престижный герб',en:'Prestige crest',cat:'crest' as Tab},
        ]:[
          {img:root+'gold-coin.webp',ru:'Бонус золота',en:'Gold +'+tier*2+'%',cat:null},
          {img:vipRoot+'perks/experience.svg',ru:'Бонус опыта',en:'XP +'+tier*2+'%',cat:null},
          {img:root+'potion-hp-viking.webp',ru:'Умный пояс · VIP 3',en:'Smart belt · VIP 3',cat:null},
          {img:root+'assets/territory/map/icons/rune-stones-v1.webp',ru:'Пресеты рун · VIP 3',en:'Rune sets · VIP 3',cat:null},
        ]).map((x,i)=><button type="button" className="vip-benefit-card" key={i}
          disabled={tier<5&&i<2} onClick={()=>x.cat?changeTab(x.cat):tier<5&&i===2?onBelt():tier<5&&i===3?onRunes():setMode('chests')}>
          <img src={x.img} alt="" draggable={false}/>
          <strong>{en?x.en:x.ru}</strong>
          {tier<5&&i<2&&<small>+{tier*2}%</small>}
        </button>)}
      </div>
      <button type="button" className="vip-gold-action vip-short-action"
        onClick={()=>changeTab(tier===10?'throne':'crown')}>
        {en?'Try on prestige cosmetics':'Живая примерка'} <ChevronRight size={16}/>
      </button>
    </div>}

    {mode==='tryon'&&<div className="vip-carved-panel vip-content-panel" data-testid="vip-live-tryon">
      <h3 className="vip-section-title"><Sparkles size={18}/>{en?'Live try-on':'Живая примерка'}</h3>
      <div className="vip-cosmetic-tabs" role="group" aria-label={en?'Cosmetic category':'Категория оформления'}>
        {tabs.map(cat=><button type="button" key={cat} aria-pressed={cat===tab} onClick={()=>changeTab(cat)}>
          <span>{tabLabels[cat].symbol}</span>{en?tabLabels[cat].en:tabLabels[cat].ru}
        </button>)}
      </div>
      {cosmetic&&<div className="vip-tryon-feature" data-testid="vip-tryon-choice">
        <div className="vip-tryon-detail">
          <strong>{en?cosmetic.en:cosmetic.ru}</strong>
          <span>{en?'Unlocks at VIP':'Доступно с VIP'} {cosmetic.minVip}</span>
          <div className="vip-tryon-controls">
            <button type="button" onClick={()=>setCosmeticIndex(n=>(n+cosmetics.length-1)%cosmetics.length)}
              aria-label={en?'Previous cosmetic':'Предыдущее оформление'}><ChevronLeft size={19}/></button>
            <span>{cosmeticIndex%cosmetics.length+1} / {cosmetics.length}</span>
            <button type="button" onClick={()=>setCosmeticIndex(n=>(n+1)%cosmetics.length)}
              aria-label={en?'Next cosmetic':'Следующее оформление'}><ChevronRight size={19}/></button>
          </div>
          {eligible?<button type="button" className="vip-gold-action" onClick={equip}>
            {equipped?<><Check size={15}/>{en?'Equipped — remove':'Надето — снять'}</>:en?'Equip':'Надеть'}
          </button>:<div className="vip-locked-label"><LockKeyhole size={14}/>
            {en?'View only · unlocks at VIP '+cosmetic.minVip:'Только просмотр · доступно с VIP '+cosmetic.minVip}
          </div>}
        </div>
      </div>}
      <p className="vip-demo-disclaimer">{en?'All cosmetics can be viewed. Only unlocked VIP cosmetics can be equipped.':'Любой облик можно посмотреть. Надеть его можно только при нужном VIP.'}</p>
    </div>}

    {mode==='chests'&&<div className="vip-carved-panel vip-content-panel" data-testid="vip-chest-gallery">
      <h3 className="vip-section-title"><Gift size={18}/>{en?'VIP chests':'VIP сундуки'}</h3>
      <div className="vip-chests-row">
        {(['daily','weekly'] as const).map(kind=><button type="button" key={kind}
          onClick={()=>openChest(kind)} className="vip-chest-card">
          <img src={chestArt(kind,tier)} alt="" draggable={false}/>
          <strong>{kind==='daily'?(en?'Daily chest':'Ежедневный сундук'):(en?'Weekly chest':'Еженедельный сундук')}</strong>
          <span className="vip-gold-action">{en?'Preview':'Посмотреть'}</span>
        </button>)}
      </div>
      <p className="vip-demo-disclaimer">{en?'Example rewards only; actual contents are not yet final.':'Примеры наград. Реальный состав сундуков пока не утверждён.'}</p>
    </div>}

    <div className="vip-preview-notice" data-testid="vip-preview-not-live">
      <ShieldCheck size={15}/>
      <span>{en?'Purchases and real rewards are disabled. This is a visual preview.'
        :'Платежи и реальные награды выключены. Это визуальная примерка.'}</span>
    </div>
    {chest&&<div className="vip-chest-overlay" role="dialog" aria-modal="true"
      aria-label={en?'VIP chest preview':'Предпросмотр VIP-сундука'}>
      <div className="vip-chest-dialog vip-carved-panel" data-testid="vip-chest-demo">
        <h3>{en?'VIP chest preview':'VIP сундук · предпросмотр'}</h3>
        <img className={'vip-opening-chest '+(chestOpened?'vip-opening-revealed':'')}
          src={chestArt(chest,tier)} alt="" draggable={false}/>
        {chestOpened?<div data-testid="vip-chest-demo-reward">
          <strong>{en?'Example rewards':'Примеры наград'}</strong>
          <div className="vip-sample-rewards">
            {[root+'gold-coin.webp',root+'potion-hp-viking.webp',
              root+'assets/territory/ui/shop/gem-chest-large.webp'].map(asset=><img key={asset} src={asset} alt=""/>)}
          </div>
          <button type="button" className="vip-gold-action" onClick={()=>setChestOpened(false)}>
            {en?'Try again':'Ещё раз'}
          </button>
        </div>:<button type="button" className="vip-gold-action" data-testid="vip-chest-demo-open"
          onClick={()=>setChestOpened(true)}>{en?'Open demo chest':'Открыть сундук'}</button>}
        <p>{en?'Preview only. No items are granted.':'Только просмотр. Предметы не начисляются.'}</p>
        <button type="button" className="vip-close-demo" onClick={()=>setChest(null)}>
          {en?'Close':'Закрыть'}
        </button>
      </div>
    </div>}
  </section>;
}
