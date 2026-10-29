import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {checkpointRuntime} from '../src/checkpoint_runtime.mjs';
import {createAudioCommandSource,applyCommand,commandLine} from '../src/ao_audio_commands.mjs';
import {createYmNativeStream} from '../src/gngb_ym_native_stream.mjs';
import {loadYm2203} from '../src/ao_ym2203_wasm.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {INPUT_DEFAULTS} from '../src/gngb_input_contract.mjs';

// Android checkpoint: the WASM dual YM saves the same bytes as the native
// process and, restored with the CPU and Z80, renders the same PCM.
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ROM=join(ROOT,'out/audio/gg2.bin'),RENDERER=join(ROOT,'out/audio/ym2203_lab');
const WASM=join(ROOT,'out/android/audio/ym2203.wasm');
const CPF=25152,FRAMES=1500,SAVE_AT=700;
// Coin at 500, Start at 560: the save lands while the game start music plays.
const port=(a,cycle)=>{
  const f=Math.floor(cycle/CPF);
  if(a===0x3000&&f>=500&&f<506)return INPUT_DEFAULTS[0]&~0x40;
  if(a===0x3000&&f>=560&&f<566)return INPUT_DEFAULTS[0]&~0x01;
  return INPUT_DEFAULTS[a-0x3000];
};
const bundle=selectB3Bundle(ROOT);
const missing=!bundle?'private B3 bundle missing':
  !existsSync(ROM)||!existsSync(RENDERER)?'private audio ROM or renderer missing':
  !existsSync(WASM)?'run scripts/ao_build_audio_wasm.sh':false;

test('WASM YM checkpoint equals the native one and restores the same PCM',
  {skip:missing},async()=>{
  const {dir}=await prepareAudioBundle(ROOT,bundle.dir);
  const {code}=loadFrozen(dir);
  const temp=mkdtempSync(join(tmpdir(),'gng-ckw-'));
  try{
    cpSync(dir,temp,{recursive:true});
    writeFileSync(join(temp,'gngb_runtime.mjs'),
      checkpointRuntime(readFileSync(join(dir,'gngb_runtime.mjs'),'utf8')),{mode:0o600});
    const {blocks}=await import(pathToFileURL(join(temp,'program.mjs')).href);
    const {createBoard}=await import(pathToFileURL(join(temp,'gngb_runtime.mjs')).href);
    const rom=Uint8Array.from(readFileSync(ROM));
    const wasmBytes=readFileSync(WASM);
    const chain=async(onFrame)=>{
      const source=await createAudioCommandSource(rom);
      const batches=[];let events=[],frames=0;
      const cpu=createBoard(code,blocks,{frames:FRAMES,portRead:port,
        onAudioEvent:e=>events.push({kind:e.kind,value:e.value,cycle:e.cycle}),
        onAudioComplete:m=>{
          if(m.frames<=frames)return;
          frames=m.frames;
          const {commands}=source.batch(frames*CPF,events);events=[];
          batches.push({frame:frames,commands});
          onFrame(cpu,source,frames);
        },
        onFrame:r=>{cpu.state.records[r.index-1]=null;cpu.state.events.length=0;}});
      return {cpu,source,batches,setFrames:n=>{frames=n;}};
    };
    const native=async(batches,saveAfter)=>{
      const pcm=[];let saved=null,failure=null;
      const ym=createYmNativeStream(RENDERER,{onPcm:(at,bytes)=>pcm.push(bytes),
        onStop:e=>{failure=e;}});
      for(const b of batches){
        await ym.write(b.commands.map(commandLine).join('\n')+'\n');
        if(b.frame===saveAfter)saved=await ym.save();
      }
      await ym.save();ym.kill();
      if(failure)throw failure;
      return {pcm:Buffer.concat(pcm),saved:Buffer.from(saved)};
    };
    const wasm=async(batches,{state=null,saveAfter=0}={})=>{
      const ym=(await loadYm2203(wasmBytes)).create();
      const pcm=[];let saved=null,first=null;
      try{
        if(state)ym.load(state);
        for(const b of batches){
          for(const c of b.commands){
            const block=applyCommand(ym,c);
            if(block){first??=block.firstSample;pcm.push(Buffer.from(block.samples.buffer));}
          }
          if(b.frame===saveAfter)saved=Buffer.from(ym.save());
        }
      }finally{ym.destroy();}
      return {pcm:Buffer.concat(pcm),saved,first};
    };

    let cpuState=null,audioState=null;
    const a=await chain((cpu,source,frame)=>{
      if(frame!==SAVE_AT)return;
      cpuState=structuredClone(cpu.exportState());
      audioState=structuredClone(source.exportState());
    });
    assert.equal(a.cpu.run().status,'FRAMES_DONE');
    const n=await native(a.batches,SAVE_AT);
    const w=await wasm(a.batches,{saveAfter:SAVE_AT});
    // 1. Same point, same bytes.
    assert.ok(w.saved&&n.saved);
    assert.ok(w.saved.equals(n.saved),'WASM checkpoint bytes equal native S');
    assert.ok(w.pcm.equals(n.pcm),'continuous WASM PCM equals native');

    // 2. CPU+Z80+YM restored in the WASM render the same PCM.
    const b=await chain(()=>{});
    b.cpu.importState(cpuState);
    b.source.importState(audioState);
    b.setFrames(SAVE_AT);
    assert.equal(b.cpu.run().status,'FRAMES_DONE');
    const r=await wasm(b.batches,{state:Uint8Array.from(w.saved)});
    assert.equal(r.first,SAVE_AT*1048);
    const tail=w.pcm.subarray(r.first*2);
    assert.ok(tail.some(x=>x!==0),'audio after the checkpoint must not be silent');
    assert.ok(r.pcm.equals(tail),'PCM after WASM restore is byte-identical');

    // Negative controls: a fresh synthesizer differs; bad loads fail closed.
    const cold=await wasm(b.batches).catch(e=>e);
    assert.ok(cold instanceof Error||!cold.pcm.equals(tail));
    const ym=(await loadYm2203(wasmBytes)).create();
    const bad=Uint8Array.from(w.saved);bad[0]^=1;
    assert.throws(()=>ym.load(bad),{code:'AUDIO_YM_LOAD_INVALID'});
    const late=(await loadYm2203(wasmBytes)).create();
    late.render(0);
    assert.throws(()=>late.load(Uint8Array.from(w.saved)),{code:'AUDIO_YM_LOAD_INVALID'});
  }finally{rmSync(temp,{recursive:true,force:true});}
});
