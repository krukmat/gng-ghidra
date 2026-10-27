/** H3 lab coverage: distinct g6 compiled blocks executed by boss-search tapes
 * that no certified tape (B2-D + B3) executes. `blocks` is wrapped in memory
 * (lookup counting only); the frozen bundle and runtime are untouched.
 * Usage: node scripts/h3_boss_coverage.mjs check | <search-tape.json>...
 */
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {B3_PROFILES,b3Tape} from '../src/v3_b3_tapes.mjs';
import {B2D_PROFILES,b2dTape,b2dCoverageFrames} from '../src/v3_b2d_tapes.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {parseLabPokes,applyLabPokes} from '../src/h3_lab_poke.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const bankOf=k=>k>=0x100000?'ram':k>=0x10000?'b'+((k>>16)-1):'fixed';
const hex=k=>bankOf(k)+':'+(k&0xffff).toString(16).padStart(4,'0');

async function replay(events,frames,poke='',wrap=true){
  const seen=new Set(),pokes=parseLabPokes(poke),hash=createHash('sha256');
  const schedule=defineInputSchedule(events);
  const table=wrap?{get:k=>{const f=blocks.get(k);if(f)seen.add(k);return f;}}:blocks;
  let last;
  const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
    manifest.files['gngb_runtime.mjs'],code,table,{frames,
      portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
      onFrame:r=>{
        const i=board.state.records.length;
        hash.update(r.record);last=r.record;board.state.records[i-1]=null;
        applyLabPokes(pokes,board.state,i);
      }});
  const res=board.run();
  const b=last,end={phase:b[0x72],loop:b[0x71],x:b[0xa0]<<8|b[0xa1],scroll:b[0x58]<<8|b[0x59]};
  return {status:res.status,pc:res.pc,frames:board.state.records.length,
    sha256:hash.digest('hex'),seen,end};
}
const certified=[
  ...B2D_PROFILES.map(p=>({name:'b2d:'+p,tape:b2dTape(p),frames:b2dCoverageFrames(p)})),
  ...B3_PROFILES.map(p=>({name:'b3:'+p,tape:b3Tape(p),frames:b3Tape(p).frames}))];
const perBank=keys=>{const o={};for(const k of keys)o[bankOf(k)]=(o[bankOf(k)]??0)+1;return o;};

if(process.argv[2]==='check'){
  const {tape,frames}=certified.find(c=>c.name==='b2d:lateStart');
  const a=await replay(tape.events,frames),b=await replay(tape.events,frames),
    c=await replay(tape.events,frames,'',false);
  const same=a.seen.size===b.seen.size&&[...a.seen].every(k=>b.seen.has(k));
  console.log('H3_COV_CHECK blocks='+a.seen.size+'/'+b.seen.size+' sameSet='+same+
    ' hashStable='+(a.sha256===b.sha256)+' hashUnwrapped='+(a.sha256===c.sha256)+
    ' status='+a.status+' frames='+a.frames+' sha='+a.sha256.slice(0,16));
  process.exitCode=same&&a.sha256===b.sha256&&a.sha256===c.sha256?0:1;
}else{
  const cert=new Set();
  for(const c of certified){
    const r=await replay(c.tape.events,c.frames);
    for(const k of r.seen)cert.add(k);
    console.log('H3_COV_CERT '+c.name+' '+r.status+' f='+r.frames+' blocks='+r.seen.size+' union='+cert.size);
  }
  const total=blocks.size,out={total,totalPerBank:perBank(blocks.keys()),
    certified:cert.size,certifiedPerBank:perBank(cert),tapes:{}};
  const allNew=new Set();
  for(const file of process.argv.slice(2)){
    const raw=JSON.parse(readFileSync(file,'utf8')),tape=resolveB3LabTape(file);
    const r=await replay(tape.events,tape.frames,raw.h3?.poke??'');
    const fresh=[...r.seen].filter(k=>!cert.has(k)).sort((a,b)=>a-b);
    for(const k of fresh)allNew.add(k);
    out.tapes[basename(file)]={poke:raw.h3?.poke,status:r.status,frames:r.frames,end:r.end,
      blocks:r.seen.size,new:fresh.length,newPct:+(100*fresh.length/total).toFixed(3),
      newPerBank:perBank(fresh),newBlocks:fresh.map(hex)};
    console.log('H3_COV_TAPE '+basename(file)+' '+r.status+' f='+r.frames+' end='+JSON.stringify(r.end)+
      ' blocks='+r.seen.size+' new='+fresh.length+' ('+(100*fresh.length/total).toFixed(2)+'%) '+JSON.stringify(perBank(fresh)));
  }
  out.newUnion=allNew.size;out.newUnionPerBank=perBank(allNew);
  const dir=join(ROOT,'out/h3/boss');mkdirSync(dir,{recursive:true,mode:0o700});
  writeFileSync(join(dir,'coverage.json'),JSON.stringify(out,null,1)+'\n',{mode:0o600});
  console.log('H3_COV_SUMMARY total='+total+' certified='+cert.size+' ('+(100*cert.size/total).toFixed(2)+
    '%) newUnion='+allNew.size+' ('+(100*allNew.size/total).toFixed(2)+'%) '+JSON.stringify(out.newUnionPerBank));
}
