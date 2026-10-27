#!/usr/bin/env node
/** Private E0 gate: frozen g4 and its in-memory lab adapter must agree. */
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {b3Tape} from '../src/v3_b3_tapes.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_LAB_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const {createBoard}=await import(pathToFileURL(join(selected.dir,'gngb_runtime.mjs')).href);
const tape=b3Tape('arthurControls'),end=2200;
const checkpoints=[311,640,1200,1974];
const hash=r=>createHash('sha256').update(r.record).update(r.known)
  .update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]))
  .digest('hex');

function options(hashes){
  let board;
  return {settings:{frames:end,
    portRead:(addr,cycle)=>tape.read(addr,cycle),
    onFrame:r=>{
      hashes.push(hash(r));
      board.state.records[board.state.records.length-1]=null;
    }},bind:b=>{board=b;}};
}
const reference=[],ref=options(reference);
const original=createBoard(code,blocks,ref.settings);ref.bind(original);
assert.equal(original.run().status,'FRAMES_DONE');
assert.equal(reference.length,end);

for(const n of checkpoints){
  const hashes=[],o=options(hashes);
  const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
    manifest.files['gngb_runtime.mjs'],code,blocks,o.settings);
  o.bind(board);
  assert.equal(board.lab.advanceTo(n).status,'FRAMES_DONE');
  assert.deepEqual(hashes,reference.slice(0,n),`frozen prefix at ${n}`);
  const saved=board.lab.save();
  assert.equal(board.lab.advanceTo(end).status,'FRAMES_DONE');
  assert.deepEqual(hashes,reference,`continuation at ${n}`);
  board.lab.restore(saved);
  hashes.length=n;
  assert.equal(board.lab.advanceTo(end).status,'FRAMES_DONE');
  assert.deepEqual(hashes,reference,`restored continuation at ${n}`);
  console.log('E0_CHECKPOINT_'+n+'=PASS');
}
console.log('E0_SNAPSHOT=PASS bundle_g='+selected.generation+
  ' frames='+end+' checkpoints='+checkpoints.join(','));
