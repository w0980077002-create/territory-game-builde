// Local visual review only. Not imported by App or the game route.
// All RPC responses are fixtures; the preview never connects to Supabase.
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from '@/game/i18n';
import {MonopolyAdventure} from './MonopolyAdventure';
import {cellPrize,type MonopolyData} from './api';
const fixture:MonopolyData={hall:{tickets:16,points:70,played:7,wins:7,pending_gold:150,claimed_gold:0,position:11,daily_remaining:850,free_ready:true,active:null},progress:{laps:5,rolls:7,events:3,double_next:false,lucky_next:false,claimed:[],pending_rewards:{gems:0,stones:0,materials:0,potions:0,elixirs:0},ends_at:new Date(Date.now()+64*3600000).toISOString()},result:null,added:0};
window.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof Request?input.url:input.toString();
 if(!url.endsWith('/rpc/territory_monopoly_v2'))return new Response(JSON.stringify({message:'Offline visual preview: network disabled'}),{status:403,headers:{'Content-Type':'application/json'}});
 const args=JSON.parse(String(init?.body??'{}'));fixture.result=null;fixture.added=0;fixture.awards={};
 if(args.p_action==='roll'&&!fixture.hall.active){
  const roll=6,old=fixture.hall.position,next=(old+roll)%28,mult=args.p_value===10?10:1;
  fixture.hall.tickets-=mult;
  fixture.hall.active={token:'10000000-0000-0000-0000-000000000003',game:'monopoly',question:{roll,old_position:old,new_position:next,board_size:28}};
 }
 if(args.p_action==='finish'&&fixture.hall.active){
  const next=fixture.hall.active.question.new_position??0;
  const awards=cellPrize(next);fixture.hall.position=next;fixture.hall.active=null;fixture.progress.rolls++;
  for(const [key,n]of Object.entries(awards))fixture.progress.pending_rewards[key as keyof typeof awards]=(fixture.progress.pending_rewards[key as keyof typeof awards]??0)+n;
  fixture.result={won:true,earned_gold:75,points:10,daily_remaining:775,tickets:fixture.hall.tickets,game:'monopoly',new_position:next,event:'gift',awards:{...awards,gems:3}};
 }
 if(args.p_action==='gift'){fixture.hall.free_ready=false;fixture.hall.tickets+=2;fixture.awards={potions:1};}
 if(['quest','offer','milestone'].includes(args.p_action)){
  fixture.progress.claimed.push(`${args.p_action}:${args.p_value}`);fixture.added=2;fixture.hall.tickets+=2;fixture.awards={gems:10,stones:20,materials:5,potions:1,elixirs:1};
 }
 return new Response(JSON.stringify(fixture),{headers:{'Content-Type':'application/json'}});
};
createRoot(document.getElementById('root')!).render(<LanguageProvider><div className="visual-review-label">Визуальный просмотр · тестовые данные · без сервера</div><MonopolyAdventure onBack={()=>window.scrollTo({top:0})}/></LanguageProvider>);
