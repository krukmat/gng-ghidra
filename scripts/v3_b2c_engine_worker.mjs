#!/usr/bin/env node
/** Genuine GnG AOT execution worker, never draws or simulates a frame.
 * The only pixel source is renderGngbRgba(snapshot from createBoard).
 * The only gameplay source is the immutable private AOT program.
 */
import {parentPort,workerData} from 'node:worker_threads';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {gngbGraphics,rendererInputs} from './r35_t5_render_check.mjs';

const inputs=new Int32Array(workerData.inputs);
const advance=new Int32Array(workerData.advance);
const send=(message,transfer=[])=>parentPort.postMessage(message,transfer);
let seenCoin=0,seenStart=0,seenP1=0,totalReads=0;
let lastGood=0;
let cpu;
try{
  const dir=resolve(workerData.bundle);
  const {manifest,code}=loadFrozen(dir);
  if(!Number.isInteger(manifest.frames)||manifest.frames<600||
     manifest.blocks<1||manifest.blocks>30000)
    throw Error('V3_B2C_UNVERIFIED_BUNDLE');
  // The manifest proves the original *certification run* length, not the
  // duration of an interactive session. This only changes the number of
  // runtime VBlank snapshots requested; immutable AOT bytes stay identical.
  const requestedFrames=workerData.sessionFrames;
  if(!Number.isSafeInteger(requestedFrames)||requestedFrames<600||
     requestedFrames>12000)throw Error('V3_B2C_SESSION_FRAMES_INVALID');
  // Private graphics are decoded once from the operator's own local ROM;
  // MAME and the AOT compiler are never imported/executed here.
  const zip=resolve(workerData.zip);
  const gfx=gngbGraphics(name=>execFileSync('unzip',['-p',zip,name],
    {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
  const {blocks}=await import(pathToFileURL(join(dir,'program.mjs')).href);
  const {createBoard}=await import(pathToFileURL(join(dir,'gngb_runtime.mjs')).href);
  if(!(blocks instanceof Map)||blocks.size!==manifest.blocks)
    throw Error('V3_B2C_BLOCKS_MISMATCH');
  send({type:'boot',source:'private-frozen-AOT',blocks:blocks.size,
    bundleCommit:manifest.source_git_head,
    certifiedFrames:manifest.frames,sessionFrames:requestedFrames});

  cpu=createBoard(code,blocks,{frames:requestedFrames,
    portRead:(addr,cycle)=>Atomics.load(inputs,addr-0x3000),
    onPortRead:read=>{
      totalReads++;
      if(read.addr===0x3000){
        if((read.value&0x40)===0)seenCoin++;
        if((read.value&0x01)===0)seenStart++;
      }else if(read.addr===0x3001)seenP1++;
    },
    onFrame:frame=>{
      // Snapshot is emitted by the ACTUAL runtime. Never infer the
      // uninitialized sprite DMA buffer from zeros or MAME captures.
      const unknown=rendererUnknownCount(frame);
      const packet={type:'frame',index:frame.index,known:unknown===0,
        unknownBytes:unknown,cycle:cpu.state.C,
        reads:totalReads,coinReads:seenCoin,startReads:seenStart,
        p1Reads:seenP1,lastGoodFrame:lastGood};
      let transfer=[];
      if(unknown===0){
        const image=renderGngbRgba(rendererInputs(frame.record,
          {scroll:frame.scroll,latch:frame.latch},gfx));
        if(image.width!==256||image.height!==224||
           image.rgba.length!==256*224*4)throw Error('V3_B2C_RENDER_GEOMETRY');
        const pixels=Uint8Array.from(image.rgba);
        packet.rgba=pixels.buffer;transfer=[pixels.buffer];
        packet.lastGoodFrame=lastGood=frame.index;
      }
      // Keep worker at the actual video boundary until the display
      // releases it; this is not a replay of a prerecorded screenshot.
      const seq=Atomics.load(advance,0);
      send(packet,transfer);
      if(Atomics.wait(advance,0,seq,30000)==='timed-out')
        throw Error('V3_B2C_FRAME_ACK_TIMEOUT');
    }
  });
  const result=cpu.run();
  send({type:'halt',status:result.status,
    frame:cpu.state.records.length,sessionFrames:requestedFrames,
    missing:result.status==='UNCOMPILED'?{
      bank:result.bank,pc:result.pc,overlay:result.overlay}:null,
    reads:totalReads,coinReads:seenCoin,startReads:seenStart,
    p1Reads:seenP1});
}catch(e){
  send({type:'error',code:e?.code??e?.message??'UNEXPECTED',
    frame:cpu?.state.records?.length??0});
}
