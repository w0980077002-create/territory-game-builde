/** Serialize all VIP reward RPCs per player, including daily and weekly claims.
 * A status read may not absorb a claim or race a second reward write.
 */
const tasks=new Map<string,Promise<void>>();
export function exclusiveVipClaim<T>(userId:string,work:()=>Promise<T>):Promise<T>{
  const previous=tasks.get(userId) ?? Promise.resolve();
  const task=previous.then(work);
  const tail=task.then(()=>{},()=>{});
  tasks.set(userId,tail);
  void tail.then(()=>{if(tasks.get(userId)===tail)tasks.delete(userId);});
  return task;
}
