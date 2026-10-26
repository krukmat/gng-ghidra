import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifySlot,compareSlots,RECORD_BYTES} from '../src/v2_b1_gate_lib.mjs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
function put(dir,name,value=1){
 const rec=Buffer.alloc(RECORD_BYTES,value),known=Buffer.alloc(RECORD_BYTES,255);
 const meta={index:1,scroll:[0,0,0,0],bank:null,latch:Array(8).fill(null),
   sprite_buffer_valid:true,writes:{dma:0,scroll:0,bank:0,latch:0}};
 const h=hash(Buffer.concat([rec,known,Buffer.from(JSON.stringify(
   [meta.scroll,meta.bank,meta.latch,meta.sprite_buffer_valid,meta.writes]))]));
 const report={schema:'gng.v2.b1.frozen-run.v1',status:'FRAMES_DONE',
   frames:1,unknowns:[0],visible_unknowns:[0],frame_hashes:[h],
   sequence_sha256:hash(h+'\n'),events:[['CPU_RESET',0]]};
 writeFileSync(join(dir,name+'-frames.bin'),rec);
 writeFileSync(join(dir,name+'-known.bin'),known);
 writeFileSync(join(dir,name+'-meta.jsonl'),JSON.stringify(meta)+'\n');
 writeFileSync(join(dir,name+'.json'),JSON.stringify(report));
}
test('verify every frame input, digest and deterministic twin run',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v2-slot-'));
 put(dir,'one');put(dir,'two');
 assert.equal(compareSlots(verifySlot(dir,'one'),verifySlot(dir,'two')),true);
 const corrupted=readFileSync(join(dir,'one-frames.bin'));corrupted[0]^=1;
 writeFileSync(join(dir,'one-frames.bin'),corrupted);
 assert.throws(()=>verifySlot(dir,'one'),/V2_B1_SLOT_FRAME_HASH_MISMATCH/);
});
test('mutating video bytes makes independent slots diverge',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v2-neg-'));
 put(dir,'one');put(dir,'two',2);
 assert.throws(()=>compareSlots(verifySlot(dir,'one'),verifySlot(dir,'two')),
               /V2_B1_NONDETERMINISTIC/);
});
