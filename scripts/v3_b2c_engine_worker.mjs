#!/usr/bin/env node
/** Genuine GnG AOT execution worker, never draws or simulates a frame.
 * The only pixel source is renderGngbRgba(snapshot from createBoard).
 * The only gameplay source is the immutable private AOT program.
 */
import {parentPort,workerData} from 'node:worker_threads';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {validateLiveFrames} from '../src/v3_b2c_session_policy.mjs';
import {createPortReadWitness} from '../src/v3_b2c_port_witness.mjs';
import {inspectRealFrame} from '../src/v3_b2c_pixel_probe.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {createPortRecorder} from '../src/v3_b3_live_tape.mjs';
import {gngbGraphics,rendererInputs} from './r35_t5_render_check.mjs';

const inputs=new Int32Array(workerData.inputs);
const advance=new Int32Array(workerData.advance);
// Checkpoint: the server sets saveRequest[0]=1; the next frame boundary
// exports the board (runtime patched by src/checkpoint_runtime.mjs).
const saveRequest=new Int32Array(workerData.saveRequest);
const restored=workerData.checkpoint??null;
const send=(message,transfer=[])=>parentPort.postMessage(message,transfer);
const witness=createPortReadWitness();
// Exact replayable record of every value the CPU read from SYSTEM/P1/DSW.
const recorder=createPortRecorder();
let lastGood=0;
let cpu;
let audioEvents=[],audioCompletedFrames=restored?.frames??0;
try{
  const dir=resolve(workerData.bundle);
  const {manifest,code}=loadFrozen(dir);
  // Manifest length is a proof horizon, not a live-session cap.
  // The AOT program remains immutable while the board runs longer.
  const requestedFrames=validateLiveFrames(manifest,workerData.sessionFrames);
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
    portRead:(addr,cycle)=>{
      const value=Atomics.load(inputs,addr-0x3000);
      recorder.observe(addr,cycle,value);
      return value;
    },
    onPortRead:read=>witness.observe(read),
    onAudioEvent:e=>{
      // Internal transport only. Never send PC or ROM-derived data to HTTP.
      audioEvents.push({kind:e.kind,value:e.value,cycle:e.cycle});
      if(audioEvents.length>5000)throw Error('AUDIO_LIVE_EVENT_OVERFLOW');
    },
    onAudioComplete:mark=>{
      if(mark.frames<=audioCompletedFrames)return;
      audioCompletedFrames=mark.frames;
      send({type:'audio-batch',sessionId:workerData.sessionId,
        throughCycle:mark.frames*CYCLES_PER_FRAME,
        events:audioEvents});
      audioEvents=[];
      if(Atomics.compareExchange(saveRequest,0,1,0)===1)
        send({type:'checkpoint',frame:mark.frames,cpu:cpu.exportState(),
          ports:recorder.drain()});
    },
    onFrame:frame=>{
      // Snapshot is emitted by the ACTUAL runtime. Never infer the
      // uninitialized sprite DMA buffer from zeros or MAME captures.
      const unknown=rendererUnknownCount(frame);
      const io=witness.snapshot();
      const packet={type:'frame',index:frame.index,known:unknown===0,
        unknownBytes:unknown,cycle:cpu.state.C,
        reads:io.busReads,coinReads:io.activeSamples.coin1,
        startReads:io.activeSamples.start1,p1Reads:io.p1Reads,
        witness:io,lastGoodFrame:lastGood,ports:recorder.drain(),
        recordSha256:createHash('sha256').update(frame.record)
          .update(frame.known).digest('hex')};
      let transfer=[];
      if(unknown===0){
        const image=renderGngbRgba(rendererInputs(frame.record,
          {scroll:frame.scroll,latch:frame.latch},gfx));
        if(image.width!==256||image.height!==224||
           image.rgba.length!==256*224*4)throw Error('V3_B2C_RENDER_GEOMETRY');
        const pixels=Uint8Array.from(image.rgba);
        packet.pixelProbe=inspectRealFrame(pixels);
        packet.rgba=pixels.buffer;transfer=[pixels.buffer];
        packet.lastGoodFrame=lastGood=frame.index;
      }
      // Delivered: drop the snapshot (records.length still counts frames).
      cpu.state.records[frame.index-1]=null;
      // Keep worker at the actual video boundary until the display
      // releases it; this is not a replay of a prerecorded screenshot.
      const seq=Atomics.load(advance,0);
      send(packet,transfer);
      // The operator may pause indefinitely at a TRUE VBlank while
      // deciding to insert Coin. Node's worker blocks, not the HTTP/UI
      // thread; reset terminates this worker and cold-starts the next.
      // No frames or CPU cycles are fabricated during this wait.
      Atomics.wait(advance,0,seq);
    }
  });
  if(restored)cpu.importState(restored);
  const result=cpu.run();
  const finalIO=witness.snapshot();
  send({type:'halt',status:result.status,
    frame:cpu.state.records.length,sessionFrames:requestedFrames,
    missing:result.status==='UNCOMPILED'?{
      bank:result.bank,pc:result.pc,overlay:result.overlay}:null,
    reads:finalIO.busReads,coinReads:finalIO.activeSamples.coin1,
    startReads:finalIO.activeSamples.start1,p1Reads:finalIO.p1Reads,
    witness:finalIO,ports:recorder.drain()});
}catch(e){
  send({type:'error',code:e?.code??e?.message??'UNEXPECTED',
    frame:cpu?.state.records?.length??0});
}
