import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {checkpointRuntime} from '../src/checkpoint_runtime.mjs';
import {resumableRuntime} from '../src/ao_resumable_runtime.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {INPUT_DEFAULTS} from '../src/gngb_input_contract.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtime=readFileSync(join(ROOT,'src/gngb_runtime.mjs'),'utf8');
const FRAMES=900,SAVE_AT=450;

test('the checkpoint patch applies to web and Android runtimes and fails closed',()=>{
  const patched=checkpointRuntime(runtime);
  assert.match(patched,/return \{state:\$,run,exportState,importState\};/);
  assert.match(patched,/const reset=\(\)=>\{\n    if\(restored\)return;/);
  assert.throws(()=>checkpointRuntime(patched),/CK_RUNTIME_PATCH_ANCHOR/);
  assert.throws(()=>checkpointRuntime(runtime.replace('  const reset=()=>{\n','  const reset=()=> {\n')),
    /CK_RUNTIME_PATCH_ANCHOR/);
  // Android applies both patches; their anchors do not overlap.
  assert.match(checkpointRuntime(resumableRuntime(runtime)),/if\(!started\)\{reset\(\);started=true;\}/);
});

// Private: needs the operator's B3 bundle and ROM-derived audio overlay.
const bundle=selectB3Bundle(ROOT);
test('a board restored at a frame boundary continues exactly like the original',
  {skip:!bundle&&'private B3 bundle missing'},async()=>{
  const {dir}=await prepareAudioBundle(ROOT,bundle.dir);
  const {code}=loadFrozen(dir);
  const temp=mkdtempSync(join(tmpdir(),'gng-ck-'));
  try{
    cpSync(dir,temp,{recursive:true});
    writeFileSync(join(temp,'gngb_runtime.mjs'),
      checkpointRuntime(readFileSync(join(dir,'gngb_runtime.mjs'),'utf8')),{mode:0o600});
    const {blocks}=await import(pathToFileURL(join(temp,'program.mjs')).href);
    const {createBoard}=await import(pathToFileURL(join(temp,'gngb_runtime.mjs')).href);
    // Input ports change over time so the restored board must keep reading them.
    const port=(a,cycle)=>{
      const f=Math.floor(cycle/25152);
      if(a===0x3000&&f%300>=200&&f%300<206)return INPUT_DEFAULTS[0]&~0x40;
      if(a===0x3000&&f%300>=260&&f%300<266)return INPUT_DEFAULTS[0]&~0x01;
      return INPUT_DEFAULTS[a-0x3000];
    };
    const trace=(out,onMark=()=>{})=>{
      const cpu=createBoard(code,blocks,{frames:FRAMES,portRead:port,
        onAudioEvent:e=>out.push(JSON.stringify(['A',e.kind,e.value,e.cycle])),
        onAudioComplete:m=>{
          out.push(JSON.stringify(['M',m.cycle,m.frames]));
          onMark(cpu,m);
        },
        onFrame:r=>{
          const h=createHash('sha256');
          h.update(r.record);h.update(r.known);
          h.update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]));
          out.push('F'+r.index+' '+cpu.state.C+' '+h.digest('hex'));
          cpu.state.records[r.index-1]=null;
        }});
      return cpu;
    };
    const whole=[];let saved=null,cut=-1;
    const original=trace(whole,(cpu,m)=>{
      if(saved||m.frames!==SAVE_AT)return;
      saved=structuredClone(cpu.exportState());cut=whole.length;
    });
    assert.equal(original.run().status,'FRAMES_DONE');
    assert.ok(saved,'state must be exported at the save frame');
    const resumed=[];
    const restored=trace(resumed);
    restored.importState(saved);
    assert.throws(()=>restored.importState(saved),/CK_IMPORT_AFTER_START/);
    assert.equal(restored.run().status,'FRAMES_DONE');
    const suffix=whole.slice(cut);
    assert.ok(suffix.filter(x=>x[0]==='F').length===FRAMES-SAVE_AT);
    assert.ok(suffix.some(x=>x.startsWith('["A"')),'audio events must be compared');
    assert.deepEqual(resumed,suffix);
    assert.equal(restored.state.C,original.state.C);
    // Negative control: one palette byte lost must change the continuation.
    const broken={...saved,palExt:saved.palExt.map((v,i)=>i===1?v^0x11:v)};
    const wrong=[];const bad=trace(wrong);bad.importState(broken);bad.run();
    assert.notDeepEqual(wrong,suffix);
  }finally{rmSync(temp,{recursive:true,force:true});}
});
