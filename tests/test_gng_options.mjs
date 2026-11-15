import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DIP_DEFAULTS,dipSwitches} from '../games/gngb/inputs.mjs';
import {DEFAULT_OPTIONS,gameOptions,optionDips,withEnemyPace} from '../games/gngb/options.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {encodeCheckpoint,decodeCheckpoint} from '../src/checkpoint_format.mjs';
import {checkpointTape} from '../src/v3_b3_live_tape.mjs';

test('DIP switches: defaults, lives and difficulty only touch DSW2 bits 0x63',()=>{
  assert.deepEqual(dipSwitches(),[...DIP_DEFAULTS]);
  assert.deepEqual(dipSwitches(),[0xdf,0xfb]);
  assert.deepEqual(dipSwitches({lives:5,difficulty:'hardest'}),[0xdf,0x99]);
  assert.deepEqual(dipSwitches({lives:7,difficulty:'easy'}),[0xdf,0xd8]);
  for(const bad of [{lives:6},{difficulty:'nightmare'},{difficulty:'toString'}])
    assert.throws(()=>dipSwitches(bad),/GNG_DIP_SETTING_INVALID/);
});

test('game options: defaults fill missing fields, invalid values refused',()=>{
  for(const none of [undefined,null,{}])assert.deepEqual(gameOptions(none),DEFAULT_OPTIONS);
  const o=gameOptions({lives:'5',difficulty:'hard',enemyPace:50});
  assert.deepEqual(o,{lives:5,difficulty:'hard',enemyPace:50});
  assert.ok(Object.isFrozen(o));
  assert.deepEqual(optionDips(o),dipSwitches({lives:5,difficulty:'hard'}));
  for(const bad of [{lives:2},{difficulty:'x'},{enemyPace:60},{enemyPace:'50'}])
    assert.throws(()=>gameOptions(bad),/GNG_OPTIONS_INVALID/);
});

test('board: DIP bytes validated before anything runs',()=>{
  for(const dips of [[1],[1,2,3],[0,256],['a',1]])
    assert.throws(()=>createBoard(null,new Map(),{dips}),/GNG_DIPS_INVALID/);
});

// A machine state that only knows what the paced block reads and writes.
function machine(t){
  const calls=[];
  const $={PC:0xa0c1,C:100,rd:a=>a===0x21?t:0};
  return {$,calls,block:$$=>{calls.push($$.PC);$$.PC=0x1234;}};
}
for(const key of [0xa0c1,'fixed\u0000main\u00000\u000041153']){
  test('enemy pace wraps the enemy call under key '+JSON.stringify(key),()=>{
    const {block}=machine(0),blocks=new Map([[key,block],[1,()=>{}]]);
    assert.equal(withEnemyPace(blocks,100),blocks);
    const ran=pace=>t=>{
      const m=machine(t),paced=withEnemyPace(new Map([[key,m.block]]),pace);
      paced.get(key)(m.$);
      return m.calls.length===1?'call':m.$.PC===0xa0c9&&m.$.C===110?'skip':'?';
    };
    assert.deepEqual([0,1,2,3,4,5].map(ran(50)),['skip','call','skip','call','skip','call']);
    assert.deepEqual([0,1,2,3,4,5].map(ran(75)),['skip','call','call','call','skip','call']);
    assert.equal(blocks.get(key),block,'original blocks untouched');
  });
}
test('enemy pace refuses unknown paces and a program without the enemy call',()=>{
  assert.throws(()=>withEnemyPace(new Map(),60),/GNG_ENEMY_PACE_INVALID/);
  assert.throws(()=>withEnemyPace(new Map(),50),/GNG_ENEMY_PACE_BLOCK_MISSING/);
});

const SHA='a'.repeat(64);
function checkpoint(options){
  const ym=new Uint8Array(36);ym.set([0x47,0x59,0x4d,0x31]);ym[4]=1048&255;ym[5]=1048>>8;
  return encodeCheckpoint({programSha256:SHA,frame:1,cpu:{frames:1},
    audio:{frontier:25152},ym,tape:[[3,0,0xdf],[4,0,0x99]],options});
}
test('checkpoints and their tapes carry the options; older saves have none',()=>{
  const options={lives:5,difficulty:'hardest',enemyPace:50};
  assert.deepEqual(decodeCheckpoint(checkpoint(options),{programSha256:SHA}).options,options);
  assert.deepEqual(checkpointTape(checkpoint(options)).options,options);
  const old=decodeCheckpoint(checkpoint(undefined),{programSha256:SHA});
  assert.equal(old.options,undefined);
  assert.deepEqual(gameOptions(old.options),DEFAULT_OPTIONS);
  for(const bad of [null,[1],'x'])
    assert.throws(()=>checkpoint(bad),/CK_STATE_INCONSISTENT/);
});
