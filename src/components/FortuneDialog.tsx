import { useEffect, useRef, type ReactNode } from 'react';
export function FortuneDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const d=ref.current;const prior=document.activeElement as HTMLElement|null;
  d?.showModal();
  d?.querySelector('h2')?.focus({preventScroll:true});
  if(d)d.scrollTop=0;
  return ()=>{d?.close();prior?.focus();};
 },[]);
 return <dialog ref={ref} className="fortune-dialog" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}}>
  <h2 tabIndex={-1}>{title}</h2>{children}<button className="fortune-button" onClick={onClose} autoFocus>OK</button>
 </dialog>;
}
