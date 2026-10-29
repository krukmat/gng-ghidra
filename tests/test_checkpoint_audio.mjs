import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {checkpointRuntime} from '../src/checkpoint_runtime.mjs';
import {createAudioCommandSource,commandLine} from '../src/ao_audio_commands.mjs';
import {createYmNativeStream} from '../src/gngb_ym_native_stream.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {INPUT_DEFAULTS} from '../src/gngb_input_contract.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ROM=join(ROOT,'out/audio/gg2.bin'),RENDERER=join(ROOT,'out/audio/ym2203_lab');
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
  !existsSync(ROM)||!existsSync(RENDERER)?'private audio ROM or renderer missing':false;

// Main CPU -> Z80 -> native dual YM, saved and restored as one checkpoint.
test('CPU, Z80 and YM restored at a frame continue with identical PCM',
  {skip:missing},async()=>{
  const {dir}=await prepareAudioBundle(ROOT,bundle.dir);
  const {code}=loadFrozen(dir);
  const temp=mkdtempSync(join(tmpdir(),'gng-cka-'));
  try{
    cpSync(dir,temp,{recursive:true});
    writeFileSync(join(temp,'gngb_runtime.mjs'),
      checkpointRuntime(readFileSync(join(dir,'gngb_runtime.mjs'),'utf8')),{mode:0o600});
    const {blocks}=await import(pathToFileURL(join(temp,'program.mjs')).href);
    const {createBoard}=await import(pathToFileURL(join(temp,'gngb_runtime.mjs')).href);
    const rom=Uint8Array.from(readFileSync(ROM));
    // One text chunk of native commands per frame, built synchronously.
    const chain=async(onFrame)=>{
      const source=await createAudioCommandSource(rom);
      const texts=[];let events=[],frames=0;
      const cpu=createBoard(code,blocks,{frames:FRAMES,portRead:port,
        onAudioEvent:e=>events.push({kind:e.kind,value:e.value,cycle:e.cycle}),
        onAudioComplete:m=>{
          if(m.frames<=frames)return;
          frames=m.frames;
          const {commands}=source.batch(frames*CPF,events);events=[];
          texts.push({frame:frames,text:commands.map(commandLine).join('\n')+'\n'});
          onFrame(cpu,source,frames);
        },
        onFrame:r=>{cpu.state.records[r.index-1]=null;cpu.state.events.length=0;}});
      return {cpu,source,texts,setFrames:n=>{frames=n;}};
    };
    const render=async(texts,{state=null,saveAfter=0}={})=>{
      const pcm=[];let saved=null,failure=null;
      const first=state?Number(Buffer.from(state).readBigUInt64LE(4)):0;
      const ym=createYmNativeStream(RENDERER,{nextSample:first,
        onPcm:(at,bytes)=>pcm.push([at,bytes]),onStop:e=>{failure=e;}});
      if(state)await ym.load(state);
      for(const t of texts){
        await ym.write(t.text);
        if(t.frame===saveAfter)saved=await ym.save();
      }
      await ym.save(); // every U before it is rendered
      ym.kill();
      if(failure)throw failure;
      return {pcm:Buffer.concat(pcm.map(p=>p[1])),first,saved};
    };

    let cpuState=null,audioState=null;
    const a=await chain((cpu,source,frame)=>{
      if(frame!==SAVE_AT)return;
      cpuState=structuredClone(cpu.exportState());
      audioState=structuredClone(source.exportState());
    });
    assert.equal(a.cpu.run().status,'FRAMES_DONE');
    const whole=await render(a.texts,{saveAfter:SAVE_AT});
    assert.ok(cpuState&&audioState&&whole.saved,'checkpoint taken at the save frame');

    const b=await chain(()=>{});
    b.cpu.importState(cpuState);
    b.source.importState(audioState);
    b.setFrames(SAVE_AT);
    assert.equal(b.cpu.run().status,'FRAMES_DONE');
    assert.deepEqual(b.texts,a.texts.slice(SAVE_AT),'same YM commands after restore');
    const resumed=await render(b.texts,{state:whole.saved});
    assert.equal(resumed.first,SAVE_AT*1048);
    const tail=whole.pcm.subarray(resumed.first*2);
    assert.ok(tail.some(x=>x!==0),'audio after the checkpoint must not be silent');
    assert.ok(resumed.pcm.equals(tail),'PCM after restore is byte-identical');

    // Negative control: a fresh synthesizer at the same commands differs.
    const cold=await render(b.texts.slice(0),{state:null}).catch(e=>e);
    assert.ok(cold instanceof Error||!cold.pcm.equals(tail));
  }finally{rmSync(temp,{recursive:true,force:true});}
});
