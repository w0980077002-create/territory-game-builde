/** Test-only transport for the existing Cave React scene. No player APIs. SQL is tested separately. */
const key = 'cave-fixture-server';
const empty = () => ({ completed_stage: 0, unlocked_stage: 1, dark_stones: 50, runs: {} as Record<string, {floor:number;status:string}> });
const read = () => JSON.parse(localStorage.getItem(key) || JSON.stringify(empty())) as ReturnType<typeof empty>;
const write = (s: ReturnType<typeof empty>) => localStorage.setItem(key, JSON.stringify(s));
const projection = (s: ReturnType<typeof empty>, status?: string) => {
  const active = Object.entries(s.runs).find(([,r]) => r.status === 'active');
  return {...s, runs:undefined, active_run_id:active?.[0] ?? null,active_floor:active?.[1].floor ?? null,legacy_active_session_id:null,run_status:status};
};
const controls = { failStartAfterCommit:false, failFinishAfterCommit:false, failFinishBeforeCommit:false, finishDelay:0, calls:[] as string[] };
Object.assign(window, {__caveCloud:controls});
export const ensurePlayerSession = async () => true;
export const getCavePveStatus = async () => { controls.calls.push('status'); return projection(read()); };
export const startCavePveRun = async (id:string,floor:number) => {
  controls.calls.push('start:'+id); const s=read();
  if(s.runs[id]) { if(s.runs[id].floor!==floor) throw Error('floor mismatch'); return projection(s,s.runs[id].status); }
  if(Object.values(s.runs).some(r=>r.status==='active')) throw Error('active');
  if(floor<1||floor>s.unlocked_stage||s.dark_stones<1) throw Error('locked');
  s.runs[id]={floor,status:'active'}; s.dark_stones--; write(s);
  if(controls.failStartAfterCommit) { controls.failStartAfterCommit=false; throw Error('lost start response'); }
  return projection(s,'active');
};
export const finishCavePveRun = async (id:string,won:boolean) => {
  controls.calls.push('finish:'+id); if(controls.failFinishBeforeCommit) throw Error('offline');
  const s=read(), r=s.runs[id]; if(!r) throw Error('unknown run');
  if(r.status==='active') { r.status=won?'won':'lost'; if(won) {s.completed_stage=Math.max(s.completed_stage,r.floor);s.unlocked_stage=Math.min(100,s.completed_stage+1);}else s.dark_stones++;write(s); }
  if(controls.finishDelay) await new Promise(resolve=>setTimeout(resolve,controls.finishDelay));
  if(controls.failFinishAfterCommit) { controls.failFinishAfterCommit=false; throw Error('lost finish response'); }
  return projection(s,r.status);
};
