/** ROM-free, read-only classification of historical bot search reports.
 * A horizon is not a win, a life decrement is not the collision frame,
 * and an AOT halt is a censored observation.
 */
const HALT_STATUSES=new Set(['UNCOMPILED','BLOCK_ENTRY']);
const validNumber=x=>Number.isSafeInteger(x)&&x>=0;

export function trailingPlateau(metrics,{windowFrames=200,tolerancePx=8}={}){
  if(!validNumber(windowFrames)||windowFrames<1||
     !validNumber(tolerancePx))throw Error('BOT_DIAGNOSTIC_WINDOW');
  if(!metrics||metrics.status!=='FRAMES_DONE'||metrics.known!==true||
     metrics.livesLost!==0||!Array.isArray(metrics.checkpoints))return false;
  const samples=metrics.checkpoints;
  if(samples.length<2)return false;
  const last=samples[samples.length-1];
  if(!validNumber(last.frame)||!validNumber(last.world)||
     !validNumber(last.lives))return false;
  const cutoff=last.frame-windowFrames;
  let first=-1;
  for(let i=0;i<samples.length;i++){
    const s=samples[i];
    if(!validNumber(s.frame)||!validNumber(s.world)||
       !validNumber(s.lives)||s.lives!==last.lives)return false;
    if(s.frame<=cutoff)first=i;
    if(i&&s.frame<=samples[i-1].frame)return false;
  }
  if(first<0)return false;
  const window=samples.slice(first);
  const positions=window.map(s=>s.world);
  return Math.max(...positions)-Math.min(...positions)<=tolerancePx;
}

export function inspectEntry(entry,options){
  if(!entry||!entry.metrics||typeof entry.metrics.status!=='string')
    throw Error('BOT_DIAGNOSTIC_ENTRY');
  const m=entry.metrics;
  const censored=HALT_STATUSES.has(m.status);
  const completed=m.status==='FRAMES_DONE';
  const lost=validNumber(m.livesLost)?m.livesLost:null;
  const kind=censored?'CENSORED_HALT':!completed?'UNKNOWN_TERMINATION':
    lost===null?'UNKNOWN_OUTCOME':lost>0?'LIFE_LOSS':'HORIZON_ONLY';
  return {
    id:entry.id??null,
    tape:typeof entry.tape==='string'?entry.tape:null,
    cut:entry.plan?.cut??null,
    kind,status:m.status,
    frames:validNumber(m.frames)?m.frames:null,
    pc:validNumber(m.pc)?m.pc:null,
    firstLifeLossFrame:validNumber(m.firstLifeLossFrame)?
      m.firstLifeLossFrame:null,
    livesLost:lost,
    maxWorld:validNumber(m.maxWorld)?m.maxWorld:null,
    finalWorld:validNumber(m.finalWorld)?m.finalWorld:null,
    plateauCandidate:trailingPlateau(m,options),
    known:m.known===true,
  };
}

export function auditReports(reports,options){
  if(!Array.isArray(reports)||reports.length===0)
    throw Error('BOT_DIAGNOSTIC_REPORTS');
  const all=[],perReport=[];
  for(const report of reports){
    if(!report||!Array.isArray(report.entries)||
       !validNumber(report.trials)||report.entries.length!==report.trials)
      throw Error('BOT_DIAGNOSTIC_REPORT_TRIALS');
    const ids=new Set();
    const inspected=report.entries.map(entry=>{
      if(!validNumber(entry.id)||ids.has(entry.id))
        throw Error('BOT_DIAGNOSTIC_DUPLICATE_ID');
      ids.add(entry.id);
      return {...inspectEntry(entry,options),report:report.mode??'unknown'};
    });
    perReport.push({mode:report.mode??'unknown',trials:inspected.length,
      censored:inspected.filter(x=>x.kind==='CENSORED_HALT').length});
    all.push(...inspected);
  }
  const censored=all.filter(x=>x.kind==='CENSORED_HALT');
  const completed=all.filter(x=>x.status==='FRAMES_DONE');
  const losses=all.filter(x=>x.kind==='LIFE_LOSS');
  const plateaus=all.filter(x=>x.plateauCandidate);
  const haltByPc={};
  for(const e of censored){
    const key=e.pc===null?'UNKNOWN':'0x'+e.pc.toString(16).toUpperCase();
    haltByPc[key]=(haltByPc[key]??0)+1;
  }
  const peakDoomed=[...losses].filter(x=>x.maxWorld!==null)
    .sort((a,b)=>b.maxWorld-a.maxWorld)[0]??null;
  const plateau=[...plateaus].sort((a,b)=>
    (b.finalWorld??-1)-(a.finalWorld??-1))[0]??null;
  const haltExamples=[];
  const seen=new Set();
  for(const e of censored){
    const key=e.pc??'UNKNOWN';
    if(!seen.has(key)){seen.add(key);haltExamples.push(e);}
  }
  return {total:all.length,completed:completed.length,censored:censored.length,
    unresolved:all.length-completed.length-censored.length,
    lifeLoss:losses.length,plateauCandidates:plateaus.length,
    haltByPc,perReport,
    examples:{peakDoomed,plateau,haltExamples}};
}

export function captureFramesAround(eventFrame,{before=120,after=60,
  step=15,endFrame=3600}={}){
  if(!validNumber(eventFrame)||eventFrame<1||!validNumber(before)||
     !validNumber(after)||!validNumber(step)||step<1||
     !validNumber(endFrame)||endFrame<1)
    throw Error('BOT_DIAGNOSTIC_CAPTURE');
  const start=Math.max(1,eventFrame-before),end=Math.min(endFrame,eventFrame+after);
  if(start>end)return [];
  const frames=new Set([Math.min(eventFrame,endFrame)]);
  for(let f=start;f<=end;f+=step)frames.add(f);
  return [...frames].sort((a,b)=>a-b);
}
