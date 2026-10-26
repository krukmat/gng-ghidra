#!/usr/bin/env node
/**
 * R3.5.B2 offline parser for logs from a privately compiled instrumented
 * MAME MC6809. Never upgrades a text log to authenticated CPU equivalence.
 * The stock MAME binary does NOT provide these native markers.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const MARK='GNG_R35_NATIVE_V1\t';
const DEC=/^(0|[1-9][0-9]*)$/;
const HEX=/^[0-9A-Fa-f]{2,4}$/;
function number(v,radix,field){
  const matcher=radix===10?DEC:HEX;
  if(typeof v!=='string'||!matcher.test(v)||
      !Number.isSafeInteger(parseInt(v,radix)))
    throw Error('R35_NATIVE_BAD_'+field);
  return parseInt(v,radix);
}
export function decodeNativeLog(log){
  if(typeof log!=='string')throw Error('R35_NATIVE_LOG_NOT_TEXT');
  const events=[];
  for(const line of log.split('\n')){
    const pos=line.indexOf(MARK);
    if(pos<0)continue;
    const [prefix,kind,...fields]=line.slice(pos).trim().split('\t');
    if(prefix!=='GNG_R35_NATIVE_V1')throw Error('R35_NATIVE_BAD_PREFIX');
    const expected={
      CPU_RESET:1,LINE_DELIVERED:5,SYNC_ENTER:3,SYNC_EXIT:6,
      IRQ_ENTRY:4,VECTOR_FETCH:3
    };
    if(!(kind in expected)||fields.length!==expected[kind])
      throw Error('R35_NATIVE_BAD_EVENT_SHAPE');
    let event;
    if(kind==='CPU_RESET'){
      event={kind,cycles:number(fields[0],10,'CYCLES')};
    }else if(kind==='LINE_DELIVERED'){
      const [lineName,asserted,pc,cc,cyc]=fields;
      if(!['IRQ','FIRQ','NMI'].includes(lineName)||
          !['0','1'].includes(asserted))
        throw Error('R35_NATIVE_BAD_LINE');
      event={kind,line:lineName,asserted:asserted==='1',
        pc:number(pc,16,'PC'),cc:number(cc,16,'CC'),
        cycles:number(cyc,10,'CYCLES')};
    }else if(kind==='SYNC_ENTER'){
      event={kind,pc:number(fields[0],16,'PC'),
        cc:number(fields[1],16,'CC'),
        cycles:number(fields[2],10,'CYCLES')};
    }else if(kind==='SYNC_EXIT'){
      const [pc,cc,irq,firq,nmi,cyc]=fields;
      if([irq,firq,nmi].some(v=>!['0','1'].includes(v)))
        throw Error('R35_NATIVE_BAD_SYNC_LINE_STATE');
      event={kind,pc:number(pc,16,'PC'),cc:number(cc,16,'CC'),
        lines:{IRQ:irq==='1',FIRQ:firq==='1',NMI:nmi==='1'},
        cycles:number(cyc,10,'CYCLES')};
    }else if(kind==='IRQ_ENTRY'){
      const [lineName,pc,cc,cyc]=fields;
      if(!['IRQ','FIRQ','NMI'].includes(lineName))
        throw Error('R35_NATIVE_BAD_IRQ_ENTRY');
      event={kind,line:lineName,pc:number(pc,16,'PC'),
        cc:number(cc,16,'CC'),cycles:number(cyc,10,'CYCLES')};
    }else{
      event={kind,vector:number(fields[0],16,'VECTOR'),
        pc:number(fields[1],16,'PC'),
        cycles:number(fields[2],10,'CYCLES')};
    }
    events.push(event);
  }
  if(events.length===0)throw Error('R35_NATIVE_PATCH_MARKERS_ABSENT');
  return events;
}
export function classifyNativeSyncLog(log){
  const events=decodeNativeLog(log);
  let resetIndex=-1,waiting=null,lastCycles=null;
  const wakes=[];
  let seenLineEvents=0,irqEntries=0,vectors=0,resets=0,enters=0,exits=0;
  let resetInterruptedWaits=0;
  for(const event of events){
    if(event.kind==='CPU_RESET'){
      resets++;resetIndex++;
      if(waiting)resetInterruptedWaits++;
      waiting=null;
      // total_cycles() belongs to this reset epoch. A new reset may restart
      // that counter; it never carries a pending SYNC or asserted line over.
      lastCycles=event.cycles;
      continue;
    }
    if(resetIndex<0)throw Error('R35_NATIVE_EVENT_BEFORE_CPU_RESET');
    if(event.cycles<lastCycles)
      throw Error('R35_NATIVE_CPU_CYCLES_DECREASED_WITHIN_RESET_EPOCH');
    lastCycles=event.cycles;
    // The hook emits every SYNC, not only the boot site. Pair all of them
    // before considering the address-specific masked-wake correlation.
    if(event.kind==='SYNC_ENTER'){
      if(waiting)throw Error('R35_NATIVE_NESTED_SYNC_ENTER');
      enters++;
      waiting={epoch:resetIndex,cc:event.cc,
        deliveredLines:new Map(),startPc:event.pc};
    }else if(event.kind==='LINE_DELIVERED'){
      seenLineEvents++;
      if(waiting)waiting.deliveredLines.set(event.line,event.asserted);
    }else if(event.kind==='SYNC_EXIT'){
      if(!waiting)throw Error('R35_NATIVE_SYNC_EXIT_WITHOUT_ENTRY');
      if(event.pc!==((waiting.startPc+1)&0xffff))
        throw Error('R35_NATIVE_SYNC_EXIT_WRONG_PC');
      exits++;
      const activeLines=Object.keys(event.lines).filter(name=>event.lines[name]);
      const lines=activeLines.filter(name=>waiting.deliveredLines.get(name)===true);
      const masked=lines.length>0&&activeLines.every(line=>
        line==='IRQ'?(waiting.cc&0x10)!==0:
        line==='FIRQ'?(waiting.cc&0x40)!==0:false);
      if(waiting.startPc===0x6016)wakes.push({
        epoch:waiting.epoch,
        entered_sync_pc:'0x6016',
        resume_pc:'0x6017',
        line_assertions_since_sync_entry:lines,
        masked_wake_observed:masked,
        direct_line_event_correlated:lines.length>0,
        handler_entry_correlated:false,
        cpu_cold_reset_proven:false
      });
      waiting=null;
    }else if(event.kind==='IRQ_ENTRY'){
      if(waiting)throw Error('R35_NATIVE_INTERRUPT_EVENT_DURING_SYNC_WAIT');
      irqEntries++;
    }else if(event.kind==='VECTOR_FETCH'){
      if(waiting)throw Error('R35_NATIVE_INTERRUPT_EVENT_DURING_SYNC_WAIT');
      vectors++;
    }
  }
  if(waiting)throw Error('R35_NATIVE_SYNC_ENTRY_WITHOUT_EXIT_OR_RESET');
  const maskedWakes=wakes.filter(x=>x.masked_wake_observed).length;
  return {
    schema:'gng.r3.native-sync-irq-core-log.v1',
    status:maskedWakes>0?'NATIVE_MASKED_SYNC_WAKE_EVENT_CORRELATED':
      'NATIVE_SYNC_WAKE_NOT_CORRELATED',
    total_native_events:events.length,
    cpu_reset_events:resets,
    sync_entry_events:enters,
    sync_exit_events:exits,
    reset_interrupted_sync_waits:resetInterruptedWaits,
    target_sync_exit_events:wakes.length,
    irq_line_delivery_events:seenLineEvents,
    irq_handler_entry_events:irqEntries,
    vector_fetch_events:vectors,
    masked_sync_wakes_with_direct_asserted_line:maskedWakes,
    events:wakes,
    native_log_parser_pass:true,
    instrumented_binary_hash_verified:false,
    compiled_js_irq_equivalence_verified:false,
    full_bus_equivalence_verified:false,
    game_playable:false,
    next_task:'Build and execute instrumented MAME privately; attest binary provenance, compare real signal timing and stack/vector effects with generated JS'
  };
}
async function main(){
  const args=process.argv.slice(2);
  const take=(flag,otherwise)=>{
    const i=args.indexOf(flag);return i<0?otherwise:args[i+1];
  };
  const out=resolve(take('--out','out/r3/native-irq-report'));
  const rel=relative(resolve('out/r3'),out);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R35_NATIVE_OUTPUT_NOT_PRIVATE');
  const logFile=take('--log','out/r3/native-mame-execution/mame.log');
  const report=classifyNativeSyncLog(await readFile(logFile,'utf8'));
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='NATIVE_MASKED_SYNC_WAKE_EVENT_CORRELATED')
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error('GNG_R35_NATIVE_IRQ=BLOCKED '+e.message);
    process.exitCode=2;
  });
