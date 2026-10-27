#!/usr/bin/env node
/** Local RAM signal probe. Values stay on the operator's Mac. */
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {spriteFromBuffer} from '../src/sprite_memory.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [profile='botA',list='1200,1500,1800,2200,2600,3000,3400,3800,4200,4600,5000,5400']
  =process.argv.slice(2);
const frames=list.split(',').map(Number),want=new Set(frames);
if(!frames.length||frames.some(n=>!Number.isInteger(n)||n<1))
  throw Error('V3_B3_SIGNAL_FRAMES_INVALID');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {code}=loadFrozen(selected.dir),tape=resolveB3LabTape(profile);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const {createBoard}=await import(pathToFileURL(join(selected.dir,'gngb_runtime.mjs')).href);
const samples=new Map();
const board=createBoard(code,blocks,{frames:Math.max(...frames),
  portRead:(addr,cycle)=>tape.read(addr,cycle),
  onFrame:r=>{
    const n=board.state.records.length;
    if(want.has(n))samples.set(n,{ram:r.record.slice(0,0x2000),
      sprite:r.record.slice(0x2000,0x2200),
      scroll:r.scroll[0]|r.scroll[1]<<8,known:r.known.slice(0,0x2000)});
    board.state.records[n-1]=null;
  }});
const result=board.run();
if(result.status!=='FRAMES_DONE')throw Error('V3_B3_SIGNAL_'+result.status);
for(const n of frames){
  const s=samples.get(n);
  console.log('FRAME '+n+' scroll='+s.scroll+' world_x='+(s.ram[0xa0]*256+s.ram[0xa1])+
    ' ybytes='+s.ram[0xa2]+','+s.ram[0xa3]+
    ' lives='+s.ram[0x60]+' stage_candidate='+s.ram[0x52]);
  console.log('PLAYER_STATE '+n+' '+Array.from(s.ram.slice(0x50,0x80))
    .map(v=>v.toString(16).padStart(2,'0')).join(' '));
}
// Candidates are compact traces only; no full RAM export.
const candidates=[];
for(let addr=0;addr<0x1e00;addr++){
  const values=frames.map(f=>samples.get(f).ram[addr]);
  if(!frames.every(f=>samples.get(f).known[addr]===255))continue;
  const distinct=new Set(values);
  if(distinct.size<2||distinct.size>6)continue;
  // HUD lives/phase flags should change across deaths, remain small, and
  // not bounce every frame like timers and sprite coordinates.
  if(values.every(v=>v<=9)&&values.slice(0,3).every(v=>v===values[0])&&
     values.slice(-3).some(v=>v!==values[0]))
    candidates.push([addr.toString(16).padStart(4,'0'),values.join(',')]);
}
console.log('SMALL_TRANSITIONS '+candidates.length);
for(const [addr,values] of candidates.slice(0,100))
  console.log(addr+' '+values);
const early=frames.filter(f=>f>=1500&&f<=2200);
if(early.length>=5){
  const xs=early.map(f=>samples.get(f).scroll);
  const corr=ys=>{
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length;
    const my=ys.reduce((a,b)=>a+b,0)/ys.length;
    const dx=xs.map(x=>x-mx),dy=ys.map(y=>y-my);
    const dot=dx.reduce((s,x,i)=>s+x*dy[i],0);
    const nx=Math.hypot(...dx),ny=Math.hypot(...dy);
    return nx&&ny?dot/nx/ny:0;
  };
  const ranked=[];
  for(let addr=0;addr<0x1dff;addr++)for(const endian of ['be','le']){
    if(!early.every(f=>samples.get(f).known[addr]===255&&
      samples.get(f).known[addr+1]===255))continue;
    const ys=early.map(f=>{
      const m=samples.get(f).ram;
      return endian==='be'?m[addr]*256+m[addr+1]:m[addr]+m[addr+1]*256;
    });
    if(Math.max(...ys)>4096||Math.min(...ys)<32)continue;
    const r=corr(ys);
    if(r>0.93)ranked.push({addr,endian,r,ys});
  }
  ranked.sort((a,b)=>b.r-a.r);
  for(const row of ranked.slice(0,30))
    console.log('POSITION_CANDIDATE '+row.addr.toString(16).padStart(4,'0')+
      ' '+row.endian+' corr='+row.r.toFixed(3)+' values='+row.ys.join(','));
  for(const f of early){
    const s=samples.get(f),world=s.ram[0xa0]*256+s.ram[0xa1];
    const expected=world-s.scroll;
    const near=[];
    for(let slot=0;slot<128;slot++){
      const sprite=spriteFromBuffer(s.sprite,slot);
      if(Math.abs(sprite.x-expected)<=16&&sprite.y>=140&&sprite.y<230)
        near.push(slot+':'+sprite.x+','+sprite.y);
    }
    console.log('SPRITE_X '+f+' world='+world+' screen='+expected+
      ' near='+near.slice(0,20).join(' '));
  }
}
