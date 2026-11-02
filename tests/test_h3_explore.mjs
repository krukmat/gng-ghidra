import test from 'node:test';
import assert from 'node:assert/strict';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {defineInputSchedule} from '../src/gngb_input_contract.mjs';
import {prng,chunkMasks,extendMasks,masksToEvents,eventsToMasks,lookBoss,BOSS_LIFE,isFatal,cellKey,better,
  pickCell,cellsListing} from '../src/h3_explore.mjs';

const f=e=>e.map(x=>`${x.cycle/CPF}:${x.control}${x.pressed?'+':'-'}`);

test('la extensión conserva el prefijo y la nueva trayectoria',()=>{
  const scratch=Uint8Array.from([9,9,9,9,9,9]);
  assert.deepEqual([...extendMasks(scratch,Uint8Array.from([1,2]),Uint8Array.from([3,4])).slice(0,4)],
    [1,2,3,4]);
  assert.deepEqual([...extendMasks(scratch,Uint8Array.from([7,8,6]),Uint8Array.from([5,2])).slice(0,5)],
    [7,8,6,5,2]);
  assert.throws(()=>extendMasks(scratch,new Uint8Array(5),new Uint8Array(2)),/MASK_CAPACITY/);
});

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

test('cinta en vivo: un valor por puerto y frame, al inicio del frame',async()=>{
  const {liveToEvents}=await import('../src/h3_live_import.mjs');
  const at=(f,d=0)=>f*CPF+d;
  const changes=[[0,at(310,5),0xff],[1,at(310,16),0xff],[2,at(310,27),0xff],[0,at(311,100),0xbf],
    [0,at(317,3),0xff],[1,at(1224,9),0xfe],[1,at(1224,500),0xee],[1,at(1300),0xff],[1,at(1400),0xfd]];
  // The last change in a frame wins; nothing at or after endFrame.
  assert.deepEqual(f(liveToEvents(changes,1400)),['311:coin1+','317:coin1-','1224:p1.button1+',
    '1224:p1.right+','1300:p1.button1-','1300:p1.right-']);
  assert.equal(defineInputSchedule(liveToEvents(changes)).events.length,7);
  assert.throws(()=>liveToEvents([[1,at(5),0x7f]]),/H3_LIVE_UNMAPPED_BIT/);
  assert.throws(()=>liveToEvents([[3,at(5),0x00]]),/H3_LIVE_DIP_NOT_DEFAULT/);
  assert.throws(()=>liveToEvents([[0,at(5),0xff],[0,at(4),0xff]]),/H3_LIVE_TAPE_INVALID/);
  // P1 held before START is not pressed again by the explorer's masks.
  assert.deepEqual(f(masksToEvents(1200,Uint8Array.from([1]),1)),['1201:p1.right-']);
});
