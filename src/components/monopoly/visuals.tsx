import type {CSSProperties} from 'react';
const artSlots={gold:0,gems:1,stones:2,materials:3,potions:4,elixirs:5,chest:6,openChest:7,dice:8,quests:9,gift:10,crown:11,tile:12,start:13,mystery:14,ticket:15} as const;
export type ArtName=keyof typeof artSlots;
export function Art({name,className='',label,style}:{name:ArtName;className?:string;label?:string;style?:CSSProperties}){
 const slot=artSlots[name];
 const atlas = import.meta.env.DEV ? 'art-atlas.png' : 'art-atlas.webp';
 return <span className={`mono-art mono-art-${name} ${className}`} role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true} style={{backgroundImage:`url("${import.meta.env.BASE_URL}monopoly/${atlas}")`,backgroundPosition:`${slot%4/3*100}% ${Math.floor(slot/4)/3*100}%`,...style}}/>;
}
const pipPositions:Record<number,number[]>={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
export function Dice({value}:{value:number}){
 return <span className="mono-dice-perspective"><span className="mono-cube">{[value,7-value,3,4,2,5].map((n,i)=><span className={`mono-die-face face-${i}`} key={i}>{Array.from({length:9},(_,p)=><i key={p} className={pipPositions[n]?.includes(p)?'pip visible':'pip'}/>)}</span>)}</span></span>;
}
