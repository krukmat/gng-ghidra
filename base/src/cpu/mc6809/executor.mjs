/** MC6809 state and instruction/IRQ scheduling for precompiled blocks.
 * The board owns memory, code mapping, external lines and frame snapshots.
 */
import {CC_E,CC_I,CC_F} from './alu.mjs';

export function createMc6809State(cyclesPerFrame){
  if(!Number.isSafeInteger(cyclesPerFrame)||cyclesPerFrame<1)
    throw Error('MIGRATION_IRQ_PERIOD_INVALID');
  return {a:0,b:0,dp:0,x:0,y:0,u:0,s:0,cc:CC_I|CC_F,PC:0,
    ka:0,kb:0,kdp:255,kx:0,ky:0,ku:0,ks:0,kcc:CC_I|CC_F,
    C:0,T:cyclesPerFrame-1,limit:Number.MAX_SAFE_INTEGER,
    st:null,ipc:0,lk:0,irq:false,sync:false,frame:0,snapped:false};
}

/** `readVector`, `codeKey`, `codeContext`, `onBoundary` and bus operations
 * are provided by the board. `blocks` contains only AOT-compiled code.
 */
export function createMc6809Executor($,{blocks,cyclesPerFrame,readVector,
  codeKey,codeContext,onBoundary=()=>{},onInstructionComplete=()=>{},
  onEvent=()=>{}}){
  if(!(blocks instanceof Map)||typeof readVector!=='function'||
     typeof codeKey!=='function'||typeof codeContext!=='function'||
     typeof onBoundary!=='function'||typeof onInstructionComplete!=='function')
    throw Error('MIGRATION_CPU_ADAPTER_INVALID');
  if(!Number.isSafeInteger(cyclesPerFrame)||cyclesPerFrame<1)
    throw Error('MIGRATION_IRQ_PERIOD_INVALID');
  const ev=(...args)=>onEvent(...args);
  $.codeContext=codeContext;
  $.syncEnter=pc=>{ev('SYNC_ENTER',pc,$.cc,$.C);$.sync=true;};
  const push=(v,k,prev)=>{
    if($.ks!==65535)$.unknown('S');
    $.s=($.s-1)&0xffff;$.wk($.s,v,k,prev);
  };
  const irqEntry=()=>{
    ev('IRQ_ENTRY','IRQ',$.PC,$.cc,$.C);
    $.ipc=$.PC;
    let c=3;
    $.cc|=CC_E;$.kcc|=CC_E;
    const word=(v,k)=>{push(v&255,k&255,c);c++;push(v>>8,k>>8,c);c++;};
    word($.PC,65535);word($.u,$.ku);word($.y,$.ky);word($.x,$.kx);
    push($.dp,$.kdp,c);c++;push($.b,$.kb,c);c++;push($.a,$.ka,c);c++;
    push($.cc,$.kcc,c);c++;
    $.cc|=CC_I;
    $.irq=false;
    ev('LINE_DELIVERED','IRQ',0,$.C+c);
    $.PC=readVector(0xfff8);
    ev('VECTOR_FETCH',0xfff8,$.PC,$.C+c+3);
    $.st=[1,2,3,...Array.from({length:12},(_,i)=>4+i),16,17,18,19];
    $.C+=19;
  };
  let started=false;
  const resetCpu=()=>{
    ev('CPU_RESET',0);
    $.PC=readVector(0xfffe);
    ev('VECTOR_FETCH',0xfffe,$.PC,3);
    $.C=4;$.st=null;$.limit=Number.MAX_SAFE_INTEGER;
    started=true;
  };
  const restoreCpu=()=>{
    if(started)throw Error('MIGRATION_CPU_ALREADY_STARTED');
    started=true;
  };
  const boundary=()=>{
    let at=$.C;
    if($.st){
      const start=$.C-$.st[$.st.length-1];
      for(const p of $.st)if(start+p>=$.T){at=start+p;break;}
    }
    onBoundary(at);
    $.frame++;
    $.T=($.frame+1)*cyclesPerFrame-1;
    $.snapped=false;
  };
  const execute=({untilCycle=Number.MAX_SAFE_INTEGER,untilFrame=Infinity}={})=>{
    if(!Number.isSafeInteger(untilCycle)||untilCycle<0||
       !(untilFrame===Infinity||(Number.isSafeInteger(untilFrame)&&untilFrame>=0)))
      throw Error('MIGRATION_ADVANCE_LIMIT_INVALID');
    if(!started)resetCpu();
    $.limit=untilCycle;
    for(;;){
      if($.C>=$.T){
        boundary();onInstructionComplete();
        if($.frame>=untilFrame)return {status:'FRAMES_DONE',cycle:$.C};
      }
      if($.C>=untilCycle)return {status:'LIMIT_REACHED',cycle:$.C};
      if($.sync){
        if($.irq){
          ev('SYNC_EXIT',$.PC,$.cc,1,0,0,$.C);
          $.C+=1;$.sync=false;$.st=null;
        }else{$.C=Math.min($.T,untilCycle);$.st=null;continue;}
      }
      if($.irq){
        if(!($.kcc&CC_I))$.unknown('CC.I');
        if(!($.cc&CC_I)){irqEntry();continue;}
      }
      const key=codeKey($.PC);
      if(key===null)return {status:'CODE_UNMAPPED',pc:$.PC,cycle:$.C};
      const fn=blocks.get(key);
      if(!fn)return {status:'UNCOMPILED',pc:$.PC,key,cycle:$.C};
      fn($);
      onInstructionComplete();
    }
  };
  return {state:$,resetCpu,restoreCpu,advance:untilCycle=>execute({untilCycle}),
    runUntilFrame:untilFrame=>execute({untilFrame}),
    hasStarted:()=>started};
}
