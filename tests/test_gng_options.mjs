import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DIP_DEFAULTS,dipSwitches} from '../games/gngb/inputs.mjs';
import {DEFAULT_OPTIONS,gameOptions,optionDips,withEnemyPace,difficultyOptions,
  difficultyLevel,withSharedProgress,withGameOptions,SHARED_PROGRESS,
  addRecoveryLifeLoss}
  from '../games/gngb/options.mjs';
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

test('unified difficulty selects the original DIP and enemy pace together',()=>{
  const expected={easiest:['easy',50,0xdb],easy:['easy',75,0xdb],
    normal:['normal',100,0xfb],hard:['hard',100,0xbb],hardest:['hardest',100,0x9b]};
  for(const [level,[difficulty,enemyPace,dsw2]] of Object.entries(expected)){
    const options=difficultyOptions(level);
    assert.deepEqual(options,{lives:3,difficulty,enemyPace});
    assert.deepEqual(optionDips(options),[0xdf,dsw2]);
    assert.equal(difficultyLevel(options),level);
    assert.equal(difficultyOptions(level,{lives:7}).lives,7);
  }
  assert.deepEqual(difficultyOptions('normal'),DEFAULT_OPTIONS);
  for(const level of ['unknown','toString',undefined])
    assert.throws(()=>difficultyOptions(level),/GNG_OPTIONS_INVALID/);
});

test('legacy combinations remain exact and are identified as custom',()=>{
  const options={lives:5,difficulty:'hard',enemyPace:50};
  assert.equal(difficultyLevel(options),null);
  const restored=decodeCheckpoint(checkpoint(options),{programSha256:SHA}).options;
  assert.deepEqual(gameOptions(restored),options);
});

test('the life limit travels with saves while old sessions keep their rules',()=>{
  const options=gameOptions({...DEFAULT_OPTIONS,continues:false});
  assert.equal(options.continues,false);
  assert.deepEqual(gameOptions(decodeCheckpoint(checkpoint(options),
    {programSha256:SHA}).options),options);
  assert.equal(gameOptions(DEFAULT_OPTIONS).continues,undefined);
  for(const continues of [0,'false',null])
    assert.throws(()=>gameOptions({continues}),/GNG_OPTIONS_INVALID/);
});

test('cooperative: kept only when true, with any difficulty, and in saves',()=>{
  assert.deepEqual(gameOptions({coop:true}),{...DEFAULT_OPTIONS,coop:true});
  assert.deepEqual(gameOptions({coop:false}),DEFAULT_OPTIONS);
  assert.deepEqual(difficultyOptions('easy',{lives:5,coop:true}),
    {lives:5,difficulty:'easy',enemyPace:75,coop:true});
  assert.equal(difficultyLevel({coop:true}),'normal');
  assert.equal(difficultyOptions('easy',{coop:false}).coop,undefined);
  const options=gameOptions({coop:true,continues:false});
  assert.deepEqual(gameOptions(decodeCheckpoint(checkpoint(options),
    {programSha256:SHA}).options),options);
  for(const coop of [1,'true',null])
    assert.throws(()=>gameOptions({coop}),/GNG_OPTIONS_INVALID/);
});

for(const key of [0x77ec,'fixed\u0000main\u00000\u000030700']){
  test('cooperative wraps the turn swap under key '+JSON.stringify(key),()=>{
    // RAM where the playing block holds 0x10+i and the waiting one 0x80+i.
    const ram=new Uint8Array(0x500);
    for(let i=0;i<0x30;i++){ram[0x60+i]=0x10+i;ram[0x440+i]=0x80+i;}
    const seen=[];
    const swap=$=>{seen.push(Array.from(ram.subarray(0x440,0x470)));$.PC=0x1234;};
    const blocks=new Map([[key,swap]]),shared=withSharedProgress(blocks);
    const $={PC:0x77ec,C:100,rd:a=>ram[a],w:(a,v)=>{ram[a]=v;}};
    shared.get(key)($);
    assert.equal(seen.length,1,'the swap itself still runs');
    assert.deepEqual([$.PC,$.C],[0x1234,100],'at no CPU cost');
    const personal=[0,2,3,4,5,6,7,8,9,10,11];
    assert.equal(SHARED_PROGRESS.length,0x30-personal.length);
    seen[0].forEach((v,i)=>assert.equal(v,(personal.includes(i)?0x80:0x10)+i,'+'+i));
    assert.deepEqual(Array.from(ram.subarray(0x60,0x90)),
      Array.from({length:0x30},(_,i)=>0x10+i),'the playing block is only read');
    // Any other entry of that block runs untouched.
    ram[0x440+0x12]=0xee;$.PC=0x77f6;shared.get(key)($);
    assert.equal(seen[1][0x12],0xee);
    assert.equal(blocks.get(key),swap,'original blocks untouched');
    // Only cooperative games get the wrapper.
    assert.equal(withGameOptions(blocks,{}).get(key),swap);
    assert.notEqual(withGameOptions(blocks,{coop:true}).get(key),swap);
  });
}
test('cooperative refuses a program without the turn swap',()=>{
  assert.throws(()=>withSharedProgress(new Map()),/GNG_TURN_SWAP_BLOCK_MISSING/);
});

test('repeated recovery spends lives for the correct player and survives options roundtrip',()=>{
  const first=addRecoveryLifeLoss({lives:7},10,1);
  const repeated=addRecoveryLifeLoss(first,10,1);
  const options=addRecoveryLifeLoss(repeated,10,2);
  assert.deepEqual(options.recoveryLifeLosses,[[10,1,2],[10,2,1]]);
  assert.deepEqual(gameOptions(decodeCheckpoint(checkpoint(options),
    {programSha256:SHA}).options).recoveryLifeLosses,options.recoveryLifeLosses);
  const ram=new Uint8Array(0x2800);ram[0x27]=1;ram[0x60]=3;ram[0x440]=5;
  ram.set([0x8a,0x8b,0x8a,0x8b],0x2380);
  ram.set([0x9a,0x9b,0x9a,0x9b],0x23a0);
  const irq=$=>{$.PC=0x1234;};
  const wrapped=withGameOptions(new Map([[0x65c4,irq]]),options);
  const $={PC:0x65c4,frame:10,rd:a=>ram[a],w:(a,v)=>{ram[a]=v;}};
  wrapped.get(0x65c4)($);
  assert.deepEqual([ram[0x60],ram[0x440]],[2,3]);
  assert.deepEqual([...ram.slice(0x2380,0x2384)],[0x8a,0x8b,0x20,0x20],
    'remove the spent reserve life from the active player HUD');
  assert.deepEqual([...ram.slice(0x23a0,0x23a4)],[0x9a,0x9b,0x20,0x20]);
  $.PC=0x65c4;wrapped.get(0x65c4)($);
  assert.deepEqual([ram[0x60],ram[0x440]],[2,3],'the same IRQ only charges once');
  assert.throws(()=>addRecoveryLifeLoss({lives:3,recoveryLifeLosses:[[10,1,3]]},10,1),
    /GNG_OPTIONS_INVALID/);
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
