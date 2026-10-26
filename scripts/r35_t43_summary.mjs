#!/usr/bin/env node
/**
 * R3.5.B2.T4.3 in-container summary of one private capture. Validates the
 * per-frame reference written by r35-t43-frames.lua and classifies the
 * native IRQ/SYNC log with the existing parser. Writes summary.json next to
 * the private data and prints only fixed keys with enumerated values or
 * counts: no log line, address, register, byte or hash leaves the volume.
 */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeNativeLog,classifyNativeSyncLog} from './r3_native_irq_report.mjs';

// ram, spriteram, buffered sprites, fg, bg, palette_ext, palette, rgba.
export const RECORD_BYTES=0x1e00+0x200+0x200+0x800+0x800+0x100+0x100+0x400;

export function validateFrames(meta,binBytes,pngNames,expected){
  const lines=meta.split('\n').filter(Boolean);
  if(lines.length!==expected)return {status:'BLOCKED_FRAME_COUNT'};
  if(binBytes!==expected*RECORD_BYTES)return {status:'BLOCKED_FRAMES_BIN_SIZE'};
  let first=null,firstDma=null,dmaWrites=0;
  for(const [i,line] of lines.entries()){
    let row;
    try{row=JSON.parse(line);}catch{return {status:'BLOCKED_FRAMES_JSONL'};}
    if(row.index!==i+1||!Number.isSafeInteger(row.frame))
      return {status:'BLOCKED_FRAME_SEQUENCE'};
    if(first===null)first=row.frame;
    if(row.frame!==first+i)return {status:'BLOCKED_FRAME_SEQUENCE'};
    if(!pngNames.has(`${String(row.frame).padStart(4,'0')}.png`))
      return {status:'BLOCKED_PNG_MISSING'};
    dmaWrites+=row.dma_writes;
    if(firstDma===null&&row.sprite_buffer_valid)firstDma=row.index;
  }
  return {status:'PASS',frames:lines.length,first_frame:first,
    first_sprite_dma_index:firstDma,dma_writes:dmaWrites};
}

export function nativeSummary(log,frames){
  let events;
  try{events=decodeNativeLog(log);}catch(e){
    return {status:'BLOCKED_'+e.message};
  }
  const count=(kind,pred=()=>true)=>
    events.filter(x=>x.kind===kind&&pred(x)).length;
  const out={
    cpu_reset_events:count('CPU_RESET'),
    irq_asserts:count('LINE_DELIVERED',x=>x.line==='IRQ'&&x.asserted),
    irq_clears:count('LINE_DELIVERED',x=>x.line==='IRQ'&&!x.asserted),
    firq_or_nmi_events:count('LINE_DELIVERED',x=>x.line!=='IRQ'),
    sync_enters:count('SYNC_ENTER'),
    irq_entries:count('IRQ_ENTRY'),
    vector_fetches:count('VECTOR_FETCH'),
  };
  // One VBLANK IRQ assertion per completed frame is the expected source.
  out.irq_asserts_match_frames=out.irq_asserts===frames||
    out.irq_asserts===frames+1;
  try{
    const report=classifyNativeSyncLog(log);
    return {...out,status:report.status,
      target_sync_wakes:report.target_sync_exit_events,
      masked_target_wakes:report.masked_sync_wakes_with_direct_asserted_line};
  }catch(e){
    return {...out,status:'BLOCKED_'+e.message};
  }
}

async function main(){
  const [dir,expectedText]=process.argv.slice(2);
  const expected=Number(expectedText);
  if(!dir||!Number.isSafeInteger(expected))throw Error('R35_T43_SUMMARY_ARGS');
  const base=resolve(dir);
  const frames=validateFrames(
    await readFile(resolve(base,'capture/frames.jsonl'),'utf8'),
    (await readFile(resolve(base,'capture/frames.bin'))).length,
    new Set(await readdir(resolve(base,'capture/png'))),expected);
  const native=nativeSummary(
    await readFile(resolve(base,'private-runner/mame.log'),'utf8'),
    frames.frames??expected);
  await writeFile(resolve(base,'summary.json'),
    JSON.stringify({schema:'gng.r35.t43-capture-summary.v1',frames,native},null,2)+'\n');
  const flat={
    R35_T43_FRAMES:frames.status,
    R35_T43_FRAMES_RECORDED:frames.frames??0,
    R35_T43_FIRST_SPRITE_DMA_INDEX:frames.first_sprite_dma_index??'NONE',
    R35_T43_NATIVE:native.status,
    R35_T43_CPU_RESET_EVENTS:native.cpu_reset_events??0,
    R35_T43_IRQ_ASSERTS:native.irq_asserts??0,
    R35_T43_IRQ_ASSERTS_MATCH_FRAMES:native.irq_asserts_match_frames?'YES':'NO',
    R35_T43_IRQ_ENTRIES:native.irq_entries??0,
    R35_T43_TARGET_SYNC_WAKES:native.target_sync_wakes??0,
    R35_T43_MASKED_TARGET_WAKES:native.masked_target_wakes??0,
  };
  for(const [k,v] of Object.entries(flat)){
    // Enumerated statuses are already fixed vocabulary; reject anything else.
    if(!/^[A-Z0-9_]+$/.test(String(v)))throw Error('R35_T43_SUMMARY_VALUE');
    console.log(`${k}=${v}`);
  }
  if(frames.status!=='PASS'||native.status.startsWith('BLOCKED_'))
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{
    console.log('R35_T43_SUMMARY=BLOCKED_UNREADABLE_CAPTURE');
    process.exitCode=2;
  });
