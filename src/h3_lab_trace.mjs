/** H3 lab causal trace (never shipped). Wraps in memory, pass-through, the
 * bus hooks of a lab board state ($.wk/$.rd/$.rk) and its block table; the
 * frozen bundle and runtime are untouched and nothing is logged outside the
 * record window or while `quiet`.
 * Attribution: an event belongs to record $.records.length+1 as seen after
 * it ran, i.e. the first record whose RAM includes a write (gngb_runtime
 * snapshots record i at cycle i*CPF-1, or just before the first write at or
 * past that cycle). Lines: `B rec cycle pc regs` block entry, `W rec cycle
 * pc addr old>new` write (whole window), `R rec cycle pc addr=value` read
 * (detail records only). Banked PCs carry `b<bank>:`, RAM code `ram:`.
 */
export const TRACE_MAX_WINDOW=122,TRACE_MAX_DETAIL=4;
const hex=(v,n=2)=>v.toString(16).padStart(n,'0');

/** [from,to,detail?] from argv; watch spec `addr:len` (default 0x510:2). */
export function parseTraceArgs([from,to,detail],watchSpec='0x510:2'){
  const f=Number(from),t=Number(to);
  if(!Number.isSafeInteger(f)||!Number.isSafeInteger(t)||f<2||t<f||
     t-f+1>TRACE_MAX_WINDOW)throw Error('H3_TRACE_WINDOW_INVALID');
  const d=detail?detail.split(':').map(Number):[0,-1];
  if(detail&&(d.length!==2||!d.every(Number.isSafeInteger)||d[0]<f||d[1]>t||
     d[1]<d[0]||d[1]-d[0]+1>TRACE_MAX_DETAIL))throw Error('H3_TRACE_DETAIL_INVALID');
  const [watch,len]=watchSpec.split(':').map(Number);
  if(!Number.isInteger(watch)||!Number.isInteger(len)||watch<0||len<1||len>4||
     watch+len>0x1e00)throw Error('H3_TRACE_WATCH_INVALID');
  return {from:f,to:t,detail:d,watch,len};
}

export function createTrace(blocks,{from,to,watch,len,detail=[0,-1]}){
  const t={$:null,quiet:false,lines:[],writes:[],outside:0};
  const rec=()=>t.$.records.length+1;
  const live=r=>!t.quiet&&r>=from&&r<=to;
  const inDetail=r=>!t.quiet&&r>=detail[0]&&r<=detail[1];
  const loc=pc=>(pc<0x3000?'ram:':pc<0x6000?'b'+t.$.bank+':':'')+hex(pc,4);
  const regs=$=>`a=${hex($.a)} b=${hex($.b)} x=${hex($.x,4)} y=${hex($.y,4)} `+
    `u=${hex($.u,4)} s=${hex($.s,4)} dp=${hex($.dp)} cc=${hex($.cc)}`;
  const word=()=>{
    const b=t.$.ramBytes(watch,len).bytes;
    return b.reduce((v,x)=>v*256+x,0);
  };
  t.table={get:k=>{
    const f=blocks.get(k);
    if(f&&live(rec()))t.lines.push(`B ${rec()} ${t.$.C} ${loc(t.$.PC)} ${regs(t.$)}`);
    return f;
  }};
  t.attach=$=>{
    t.$=$;
    const {wk,rd,rk}=$;
    $.wk=(a,v,mask,prev)=>{
      const pre=rec(),watched=a>=watch&&a<watch+len;
      if(!watched&&(t.quiet||pre<from-1||pre>to))return wk(a,v,mask,prev);
      const old=a<0x3000?$.ramBytes(a,1).bytes[0]:null,before=watched?word():null;
      const pc=loc($.ipc),cycle=$.C+prev;
      wk(a,v,mask,prev);
      const r=rec();
      if(!live(r)){if(watched&&!t.quiet)t.outside++;return;}
      t.lines.push(`W ${r} ${cycle} ${pc} ${hex(a,4)} ${old===null?'--':hex(old)}>${hex(v)}`);
      if(watched)t.writes.push({record:r,cycle,pc,addr:a,old,new:v,
        before,after:word(),regs:regs($)});
    };
    $.rd=(a,offset)=>{
      const v=rd(a,offset);
      if(inDetail(rec()))
        t.lines.push(`R ${rec()} ${$.C+(offset??0)} ${loc($.ipc)} ${hex(a,4)}=${hex(v)}`);
      return v;
    };
    // RAM stack reads; other addresses fall through to the wrapped $.rd.
    $.rk=(a,offset)=>{
      const v=rk(a,offset);
      if(a<0x3000&&inDetail(rec()))
        t.lines.push(`R ${rec()} ${$.C+(offset??0)} ${loc($.ipc)} ${hex(a,4)}=${hex(v)}`);
      return v;
    };
  };
  return t;
}
