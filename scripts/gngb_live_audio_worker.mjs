#!/usr/bin/env node
/** Private local producer: current MC6809 events -> Z80 -> dual YM -> PCM.
 * Batch rules are the shared createAudioCommandSource (also used on
 * Android); the dual YM runs in the native --stream process.
 * Checkpoint: workerData.checkpoint {audio, ym} restores a saved session;
 * a 'save' message answers with the state after every earlier batch.
 */
import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createAudioCommandSource,commandLine} from '../src/ao_audio_commands.mjs';
import {createYmNativeStream} from '../src/gngb_ym_native_stream.mjs';
import {ymFirstSample} from '../src/checkpoint_format.mjs';

const send=m=>parentPort.postMessage(m);
const safeCode=e=>/^AUDIO_[A-Z0-9_]{3,80}$/.test(e?.code??e?.message)?
  (e.code??e.message):'AUDIO_LIVE_UNEXPECTED_STOP';
let stopped=false;
const stop=e=>{
  if(stopped)return;
  stopped=true;send({type:'stop',code:safeCode(e)});
  ym?.kill();
};
let ym=null,source=null,pcmSamples=0,nonzero=0;
async function consumeBatch(m) {
  if(stopped||!source)return;
  if(m.sessionId!==workerData.sessionId)throw Error('AUDIO_LIVE_BATCH_INVALID');
  const {commands,stats}=source.batch(m.throughCycle,m.events);
  await ym.write(commands.map(commandLine).join('\n')+'\n');
  send({type:'stats',sessionId:workerData.sessionId,
    throughCycle:m.throughCycle,commands:stats.mainCommands,
    resetTransitions:stats.resetTransitions,latchReads:stats.latchReads,
    ymWrites:stats.ymWrites,irqRequests:stats.irqRequests,
    irqAcknowledged:stats.irqAcknowledged,
    maxOvershootTStates:stats.maxOvershootTStates,
    dynamicResolutions:stats.dynamicResolutions});
}
async function save(){
  if(stopped||!source)throw Error('AUDIO_LIVE_NOT_RUNNING');
  const audio=source.exportState();
  send({type:'checkpoint',sessionId:workerData.sessionId,audio,
    ym:await ym.save()});
}
async function main(){
  const rom=Uint8Array.from(readFileSync(workerData.rom));
  if(rom.length!==0x8000||createHash('sha1').update(rom).digest('hex')!==
     '7ef9ec5c2072e21c787a6bbf700033f50c759c1d')
    throw Error('AUDIO_LIVE_ROM_INVALID');
  const restored=workerData.checkpoint??null;
  ym=createYmNativeStream(workerData.renderer,{
    nextSample:restored?ymFirstSample(restored.ym):0,
    onStop:stop,
    onPcm:(first,bytes)=>{
      for(let i=0;i<bytes.length;i+=2)if(bytes[i]||bytes[i+1])nonzero++;
      pcmSamples+=bytes.length/2;
      send({type:'pcm',sessionId:workerData.sessionId,
        sampleRate:62500,firstSample:first,samples:bytes.buffer,
        producedSamples:pcmSamples,nonzeroSamples:nonzero});
    }});
  source=await createAudioCommandSource(rom);
  if(restored){
    source.importState(restored.audio);
    await ym.load(restored.ym);
  }
  send({type:'ready',sessionId:workerData.sessionId});
}
const initialized=main();
let chain=initialized;
parentPort.on('message',m=>{
  if(m?.type==='batch')chain=chain.then(()=>consumeBatch(m)).catch(stop);
  else if(m?.type==='save')chain=chain.then(save).catch(e=>{
    send({type:'checkpoint-failed',sessionId:workerData.sessionId});
    stop(e);
  });
});
initialized.catch(stop);
