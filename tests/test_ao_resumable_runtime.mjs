import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resumableRuntime} from '../src/ao_resumable_runtime.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {INPUT_DEFAULTS} from '../src/gngb_input_contract.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtime=readFileSync(join(ROOT,'src/gngb_runtime.mjs'),'utf8');
const FRAMES=600;

test('the resumable patch applies once to the audio runtime and fails closed',()=>{
  const patched=resumableRuntime(runtime);
  assert.match(patched,/const run=\(until=frames\)=>\{/);
  assert.match(patched,/if\(!started\)\{reset\(\);started=true;\}/);
  assert.doesNotMatch(patched,/length>=frames\)return/);
  assert.throws(()=>resumableRuntime(patched),/AO_RUNTIME_PATCH_ANCHOR/);
  assert.throws(()=>resumableRuntime(runtime.replace('    reset();\n','  reset();\n')),
    /AO_RUNTIME_PATCH_ANCHOR/);
});

// Private: needs the operator's B3 bundle and ROM-derived audio overlay.
const bundle=selectB3Bundle(ROOT);
test('frame-by-frame run(k) matches one run() on the private bundle',
  {skip:!bundle&&'private B3 bundle missing'},async()=>{
  const {dir}=await prepareAudioBundle(ROOT,bundle.dir);
  const {code}=loadFrozen(dir);
  // Same layout as the app: a full bundle copy with only the runtime patched.
  const temp=mkdtempSync(join(tmpdir(),'gng-ao1-'));
  try{
    cpSync(dir,temp,{recursive:true});
    writeFileSync(join(temp,'gngb_runtime.mjs'),
      resumableRuntime(readFileSync(join(dir,'gngb_runtime.mjs'),'utf8')),{mode:0o600});
    const load=async base=>({
      ...(await import(pathToFileURL(join(base,'program.mjs')).href)),
      ...(await import(pathToFileURL(join(base,'gngb_runtime.mjs')).href))});
    const trace=({blocks,createBoard},step)=>{
      const out=[];
      const cpu=createBoard(code,blocks,{frames:FRAMES,
        portRead:a=>INPUT_DEFAULTS[a-0x3000],
        onAudioEvent:e=>out.push(JSON.stringify(['A',e.kind,e.value,e.cycle])),
        onAudioComplete:m=>out.push(JSON.stringify(['M',m.cycle,m.frames])),
        onFrame:r=>{
          // Same per-frame identity as runFrozen, plus the CPU cycle.
          const h=createHash('sha256');
          h.update(r.record);h.update(r.known);
          h.update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]));
          out.push('F'+r.index+' '+cpu.state.C+' '+h.digest('hex'));
          cpu.state.records[r.index-1]=null;
        }});
      step(cpu);
      out.push('E '+createHash('sha256').update(JSON.stringify(cpu.state.events))
        .digest('hex')+' C '+cpu.state.C);
      return out;
    };
    const whole=trace(await load(dir),cpu=>
      assert.equal(cpu.run().status,'FRAMES_DONE'));
    const stepped=trace(await load(temp),cpu=>{
      for(let k=1;k<=FRAMES;k++){
        assert.equal(cpu.run(k).status,'FRAMES_DONE');
        assert.equal(cpu.state.records.length,k);
      }
    });
    assert.equal(whole.filter(x=>x[0]==='F').length,FRAMES);
    assert.ok(whole.some(x=>x.startsWith('["A"')),'audio events must be compared');
    assert.deepEqual(stepped,whole);
  }finally{rmSync(temp,{recursive:true,force:true});}
});
