import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {B3_TAPE_SCHEMA} from '../src/v3_b3_tapes.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';

test('private explorer tape validates canonical events and digest',()=>{
  const metadata={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames:20,
    events:[{cycle:5*CYCLES_PER_FRAME,control:'p1.right',pressed:true},
      {cycle:10*CYCLES_PER_FRAME,control:'p1.right',pressed:false}]};
  const sha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  const path=join(mkdtempSync(join(tmpdir(),'b3-tape-')),'tape.json');
  writeFileSync(path,JSON.stringify({...metadata,sha256}));
  const tape=resolveB3LabTape(path);
  assert.equal(tape.read(0x3001,4*CYCLES_PER_FRAME),0xff);
  assert.equal(tape.read(0x3001,5*CYCLES_PER_FRAME),0xfe);
  assert.equal(tape.read(0x3001,10*CYCLES_PER_FRAME),0xff);
  writeFileSync(path,JSON.stringify({...metadata,sha256:'0'.repeat(64)}));
  assert.throws(()=>resolveB3LabTape(path),/V3_B3_EXTERNAL_TAPE_HASH_MISMATCH/);
});
