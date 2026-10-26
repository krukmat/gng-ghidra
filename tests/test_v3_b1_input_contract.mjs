import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defineInputSchedule,readScheduledPort,readScheduledPorts,
        INPUT_PORTS,INPUT_CONTROLS,INPUT_DEFAULTS,INPUT_SCHEMA}
  from '../src/gngb_input_contract.mjs';
import {PORT_DEFAULTS as V2_DEFAULTS} from '../src/gngb_runtime.mjs';

const event=(cycle,control,pressed)=>({cycle,control,pressed});
const read=(t,address,cycle)=>readScheduledPort(t,address,cycle);
const err=(run,pattern)=>assert.throws(run,pattern);

test('T1.1: all five port addresses and cold-reset defaults match V2 exactly',()=>{
  assert.deepEqual(INPUT_PORTS,{SYSTEM:0x3000,P1:0x3001,P2:0x3002,DSW1:0x3003,DSW2:0x3004});
  assert.deepEqual([...INPUT_DEFAULTS],V2_DEFAULTS);
  assert.deepEqual(readScheduledPorts(defineInputSchedule(),0),V2_DEFAULTS);
  assert.deepEqual(readScheduledPorts(defineInputSchedule(),25152),V2_DEFAULTS);
  assert.equal(INPUT_SCHEMA,'gng.v3.input-contract.v1');
});

test('T1.1: gngb active-low controls map to specified port and independent bit',()=>{
  const specs={
    start1:['SYSTEM',0x01],start2:['SYSTEM',0x02],service1:['SYSTEM',0x20],
    coin1:['SYSTEM',0x40],coin2:['SYSTEM',0x80],
    'p1.right':['P1',1],'p1.left':['P1',2],'p1.down':['P1',4],
    'p1.up':['P1',8],'p1.button1':['P1',16],'p1.button2':['P1',32],
    'p2.right':['P2',1],'p2.left':['P2',2],'p2.down':['P2',4],
    'p2.up':['P2',8],'p2.button1':['P2',16],'p2.button2':['P2',32],
  };
  assert.equal(Object.keys(INPUT_CONTROLS).length,Object.keys(specs).length);
  for(const [name,[port,bit]] of Object.entries(specs)){
    assert.deepEqual(INPUT_CONTROLS[name],{port,bit,activeLow:true});
    const tape=defineInputSchedule([event(4,name,true)]);
    assert.equal(read(tape,INPUT_PORTS[port],3),0xff);
    assert.equal(read(tape,INPUT_PORTS[port],4),0xff&~bit);
  }
});

test('T1.2: coin and start are held active low, release restores high',()=>{
  const tape=defineInputSchedule([
    event(4,'coin1',true),event(10,'coin1',false),
    event(10,'start1',true),event(20,'start1',false)
  ]);
  assert.equal(read(tape,0x3000,3),0xff);
  assert.equal(read(tape,0x3000,4),0xbf);
  assert.equal(read(tape,0x3000,9),0xbf);
  assert.equal(read(tape,0x3000,10),0xfe);
  assert.equal(read(tape,0x3000,19),0xfe);
  assert.equal(read(tape,0x3000,20),0xff);
  assert.equal(read(tape,0x3001,10),0xff);
});

test('T1.2: same-cycle release then press is atomic and input-order independent',()=>{
  const first=[
    event(12,'p1.left',true),
    event(24,'p1.right',true),event(24,'p1.left',false),
  ];
  const second=[first[0],first[2],first[1]];
  const a=defineInputSchedule(first),b=defineInputSchedule(second);
  assert.deepEqual(a.events,b.events);
  assert.deepEqual(a.steps,b.steps);
  assert.equal(read(a,0x3001,23),0xfd);
  assert.equal(read(a,0x3001,24),0xfe);
  assert.equal(read(b,0x3001,24),0xfe);
  assert.equal(a.steps.length,2);
});

test('T1.2: independent P1/P2 and simultaneous buttons are legal',()=>{
  const t=defineInputSchedule([
    event(5,'p1.button1',true),event(5,'p1.button2',true),
    event(5,'p2.left',true),event(5,'coin2',true),event(5,'start2',true)
  ]);
  assert.equal(read(t,0x3001,5),0xcf);
  assert.equal(read(t,0x3002,5),0xfd);
  assert.equal(read(t,0x3000,5),0x7d);
});

test('T1.3: events are inclusive at their cycle and persist across VBlank',()=>{
  const t=defineInputSchedule([
    event(25151,'p1.right',true),event(50304,'p1.right',false)
  ]);
  assert.equal(read(t,0x3001,25150),0xff);
  assert.equal(read(t,0x3001,25151),0xfe);
  assert.equal(read(t,0x3001,25152),0xfe);
  assert.equal(read(t,0x3001,50303),0xfe);
  assert.equal(read(t,0x3001,50304),0xff);
  assert.equal(read(t,0x3001,25151),0xfe); // pure, random access
});

test('T1.3: DIPs are configured at reset only and not modified by gameplay',()=>{
  const t=defineInputSchedule([event(7,'p1.up',true)],{dip1:0xc1,dip2:0xf3});
  for(const cycle of [0,7,99999]){
    assert.equal(read(t,0x3003,cycle),0xc1);
    assert.equal(read(t,0x3004,cycle),0xf3);
  }
  err(()=>defineInputSchedule([],{dip1:-1}),/V3_B1_INPUT_DIP_INVALID/);
  err(()=>defineInputSchedule([],{dip2:256}),/V3_B1_INPUT_DIP_INVALID/);
  err(()=>defineInputSchedule([],{dip1:1.5}),/V3_B1_INPUT_DIP_INVALID/);
  err(()=>defineInputSchedule([],{foo:1}),/V3_B1_INPUT_OPTIONS_INVALID/);
  err(()=>defineInputSchedule([event(2,'DSW1',true)]),/V3_B1_INPUT_EVENT_INVALID/);
});

test('T1.4: 4-way input combinations are rejected before any CPU integration',()=>{
  for(const player of ['p1','p2']){
    for(const [a,b] of [['left','right'],['up','down'],['up','left'],['right','down']]){
      err(()=>defineInputSchedule([event(1,player+'.'+a,true),
                                   event(1,player+'.'+b,true)]),
          /V3_B1_INPUT_FOUR_WAY_COMBINATION/);
      err(()=>defineInputSchedule([event(1,player+'.'+a,true),
                                   event(2,player+'.'+b,true)]),
          /V3_B1_INPUT_FOUR_WAY_COMBINATION/);
    }
  }
});

test('T1.4: reject malformed, duplicate and impossible transitions',()=>{
  const malformed=[
    null,{},event(-1,'coin1',true),event(1.5,'coin1',true),
    event(Number.MAX_SAFE_INTEGER+1,'coin1',true),
    event(1,'coin1',1),event(1,'fake',true),
    {...event(1,'coin1',true),meta:'ignored'},
  ];
  for(const e of malformed)
    err(()=>defineInputSchedule([e]),/V3_B1_INPUT_EVENT_INVALID/);
  err(()=>defineInputSchedule('coin1'),/V3_B1_INPUT_SCHEDULE_INVALID/);
  err(()=>defineInputSchedule([event(10,'coin1',true),
                               event(9,'coin1',false)]),/V3_B1_INPUT_CYCLE_REGRESSION/);
  err(()=>defineInputSchedule([event(1,'coin1',true),
                               event(1,'coin1',false)]),/V3_B1_INPUT_DUPLICATE_SAME_CYCLE/);
  err(()=>defineInputSchedule([event(1,'coin1',false)]),
      /V3_B1_INPUT_IMPOSSIBLE_TRANSITION/);
  err(()=>defineInputSchedule([event(1,'coin1',true),
                               event(2,'coin1',true)]),
      /V3_B1_INPUT_IMPOSSIBLE_TRANSITION/);
});

test('T1.4: invalid read addresses/cycles and forged schedules fail closed',()=>{
  const t=defineInputSchedule();
  for(const address of [-1,0x2fff,0x3005,0x4000,0x3000.5,'SYSTEM'])
    err(()=>read(t,address,4),/V3_B1_INPUT_PORT_INVALID/);
  for(const cycle of [-1,NaN,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])
    err(()=>read(t,0x3000,cycle),/V3_B1_INPUT_READ_CYCLE_INVALID/);
  err(()=>read({schema:INPUT_SCHEMA,dips:[0xdf,0xfb],steps:[]},0x3000,4),
      /V3_B1_INPUT_CONTRACT_INVALID/);
});

test('T1.4: schedule copies and deep-freezes external input, never aliases',()=>{
  const source=[event(4,'coin1',true)];
  const t=defineInputSchedule(source);
  source[0].control='start1';source.push(event(5,'start1',true));
  assert.equal(read(t,0x3000,4),0xbf);
  assert.equal(t.events.length,1);
  assert.ok(Object.isFrozen(t)&&Object.isFrozen(t.events)&&
    Object.isFrozen(t.events[0])&&Object.isFrozen(t.steps)&&
    Object.isFrozen(t.steps[0].bytes)&&Object.isFrozen(t.dips));
  assert.throws(()=>{t.events[0].control='start2';},TypeError);
});

test('T1.5: input contract has no dependencies on emulator or AOT compiler',()=>{
  const code=readFileSync(new URL('../src/gngb_input_contract.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/^\s*import\s+(?:\*|\{|['"])/m);
  assert.doesNotMatch(code,/\b(?:eval|new Function)\s*\(/);
});
