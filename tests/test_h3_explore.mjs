import test from 'node:test';
import assert from 'node:assert/strict';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {defineInputSchedule} from '../src/gngb_input_contract.mjs';
import {prng,chunkMasks,masksToEvents,eventsToMasks,lookBoss,BOSS_LIFE,isFatal,cellKey,better,
  pickCell,cellsListing} from '../src/h3_explore.mjs';

const f=e=>e.map(x=>`${x.cycle/CPF}:${x.control}${x.pressed?'+':'-'}`);

test('máscaras pegajosas: misma semilla, misma cinta; cada pulsación se suelta',()=>{
  const a=chunkMasks(prng(5),600,0),b=chunkMasks(prng(5),600,0);
  assert.deepEqual(a,b);
  assert.notDeepEqual(a,chunkMasks(prng(6),600,0));
  for(let i=0;i<a.length;i++){
    assert.ok([0,1,2,4,8].includes(a[i]&15),'4-way');
    // A press lasts at most 8 frames, so a release always comes within 9.
    if(i>=8)for(const bit of [16,32])assert.ok([...a.subarray(i-8,i+1)].some(m=>!(m&bit)));
  }
  // Buttons held at the end of the previous chunk are released first.
  assert.equal(chunkMasks(prng(5),1,0x31)[0]&0x30,0);
  // The resulting tape is a valid schedule with only P1 events.
  const ev=masksToEvents(1200,a);
  assert.ok(ev.every(e=>e.control.startsWith('p1.')));
  assert.equal(defineInputSchedule(ev).events.length,ev.length);
});

test('eventos solo donde cambia la máscara y liberación final',()=>{
  assert.deepEqual(f(masksToEvents(1200,Uint8Array.from([1,1,0x21,1,0]))),
    ['1200:p1.right+','1202:p1.button2+','1203:p1.button2-','1204:p1.right-']);
  assert.deepEqual(f(masksToEvents(1200,Uint8Array.from([2,0x12]))),
    ['1200:p1.left+','1201:p1.button1+','1202:p1.button1-','1202:p1.left-']);
});

test('celda, mejor trayectoria, corte y selección',()=>{
  const s={phase:0,cp:1,x:1800,y:70,armor:0,lives:3,mode:1,handler:0x9795};
  assert.equal(cellKey(s),'0:1:112:8:0');
  assert.ok(better({armor:0,frame:900},{armor:1,frame:500}));
  assert.ok(better({armor:1,frame:499},{armor:1,frame:500}));
  assert.ok(!better({armor:1,frame:500},{armor:0,frame:900}));
  assert.ok(!isFatal({...s,mode:3},3),'impacto con armadura: otra celda');
  assert.ok(isFatal({...s,mode:3,armor:1},3));
  assert.ok(isFatal({...s,lives:2},3));
  const cells=[{key:'a',scroll:0,chosen:50},{key:'b',scroll:3072,chosen:0}];
  const rand=prng(1);let b=0;
  for(let i=0;i<200;i++)b+=pickCell(cells,rand).key==='b';
  assert.ok(b>180,'favours rarely chosen cells');
  assert.equal(cellsListing([{...cells[1],masks:new Uint8Array(1)},{...cells[0],masks:new Uint8Array(0)}])[0].key,'a');
});

test('S2: eventsToMasks invierte masksToEvents (prefijo de la cinta)',()=>{
  const a=chunkMasks(prng(9),500,0);
  assert.deepEqual(eventsToMasks(1200,1700,masksToEvents(1200,a)),a);
  // A shorter window keeps the head; non-P1 controls are ignored.
  const ev=[{cycle:1100*CPF,control:'start1',pressed:true},...masksToEvents(1200,a)];
  assert.deepEqual(eventsToMasks(1200,1300,ev),a.subarray(0,100));
  assert.equal(eventsToMasks(1700,1710,masksToEvents(1200,a)).every(m=>m===0),true);
});

test('S2: la vida del cíclope entra en la celda; S1 no cambia',()=>{
  const b=new Uint8Array(BOSS_LIFE+1);
  b[0x72]=0;b[0x81]=1;b[0xa0]=0x0d;b[0xa1]=0x82;b[0xa2]=0;b[0xa3]=89;b[0xac]=1;b[BOSS_LIFE]=3;
  const s=lookBoss(b);
  assert.equal(s.boss,3);
  assert.equal(cellKey(s),'0:1:216:11:1:3');
  const {boss,...s1}=s;
  assert.equal(cellKey(s1),'0:1:216:11:1');
  // S1 listings (and so their hashes) keep no boss field.
  assert.ok(!JSON.stringify(cellsListing([{...s1,key:'k',chosen:0,masks:new Uint8Array(0)}])).includes('boss'));
});
