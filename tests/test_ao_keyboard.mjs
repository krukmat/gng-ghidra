import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keyAction,KEYS} from '../src/ao_keyboard.mjs';
import {checkpointTape,liveTapeReader,LIVE_TAPE_SCHEMA} from '../src/v3_b3_live_tape.mjs';
import {encodeCheckpoint,CYCLES_PER_FRAME,SAMPLES_PER_FRAME}
  from '../src/checkpoint_format.mjs';
import {INPUT_CONTROLS} from '../src/gngb_input_contract.mjs';

test('keys of the retired desktop route, no modifiers, own keys only',()=>{
  assert.deepEqual(keyAction({code:'Digit5'}),{pulse:'coin1'});
  assert.deepEqual(keyAction({code:'Digit1'}),{pulse:'start1'});
  assert.deepEqual(keyAction({code:'KeyZ'}),{hold:'p1.button1'});
  assert.deepEqual(keyAction({code:'KeyT'}),{command:'tape'});
  for(const mod of ['ctrlKey','metaKey','altKey'])
    assert.equal(keyAction({code:'KeyC',[mod]:true}),null);
  for(const code of ['KeyQ','toString','__proto__'])assert.equal(keyAction({code}),null);
  for(const {hold} of Object.values(KEYS))if(hold)assert.ok(INPUT_CONTROLS[hold],hold);
});

test('a checkpoint exports its tape from reset, refused if malformed',()=>{
  const frame=3,ym=new Uint8Array(36);
  ym.set([71,89,77,49]);new DataView(ym.buffer).setUint32(4,frame*SAMPLES_PER_FRAME,true);
  const changes=[[0,10,255],[1,40,254],[1,25152*2,255]];
  const text=encodeCheckpoint({programSha256:'a'.repeat(64),frame,
    cpu:{frames:frame},audio:{frontier:frame*CYCLES_PER_FRAME},ym,tape:changes});
  const tape=checkpointTape(text);
  assert.deepEqual(tape,{schema:LIVE_TAPE_SCHEMA,program_sha256:'a'.repeat(64),
    frame,changes});
  assert.equal(liveTapeReader(tape.changes)(0x3001,41),254);
  assert.throws(()=>checkpointTape('{'),/CK_FORMAT_INVALID/);
  assert.throws(()=>checkpointTape(text.replace('"frame":3','"frame":4')),
    /CK_STATE_INCONSISTENT/);
});
