#!/usr/bin/env node
/** Probe GnG against the extracted compiler without storing generated code. */
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {compileProgram} from '../base/src/build/mc6809/compiler.mjs';
import {createGngCodeView} from '../boards/gng/code-view.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {liveTapeReader,LIVE_TAPE_SCHEMA} from '../src/v3_b3_live_tape.mjs';

const [bundleArg,framesArg,tapeArg]=process.argv.slice(2);
if(!bundleArg||!framesArg)throw Error('RP2_PROBE_USAGE: bundle frames');
const bundle=resolve(bundleArg),frames=Number(framesArg);
const {code,manifest}=loadFrozen(bundle),view=createGngCodeView(code);
const tape=tapeArg?JSON.parse(readFileSync(resolve(tapeArg))):null;
if(tape&&(tape.schema!==LIVE_TAPE_SCHEMA||
   tape.program_sha256!==manifest.files['program.mjs']))throw Error('RP2_TAPE_MISMATCH');
const portRead=()=>tape?liveTapeReader(tape.changes):null;
const vector=a=>code.fixed[a]<<8|code.fixed[a+1];
const seeds=[view.at(vector(0xfffe),null),view.at(vector(0xfff8),null)];
if(seeds.some(x=>!x))throw Error('RP2_VECTOR_OUTSIDE_CODE');
const libUrl=pathToFileURL(resolve('base/src/cpu/mc6809/alu.mjs')).href;
const blocks=new Map();
let compiled=0,attempts=0,last;
for(;attempts<256;attempts++){
  const built=compileProgram(view,seeds.splice(0),{libUrl});
  const module=await import('data:text/javascript,'+encodeURIComponent(built.source));
  for(const [key,fn] of module.blocks)blocks.set(key,fn);
  compiled=blocks.size;
  const board=createBoard(code,blocks,{frames,portRead:portRead()});
  last=board.run();
  if(last.status!=='UNCOMPILED'){
    const spaces={};
    for(const key of blocks.keys()){
      const space=key.split('\u0000',1)[0];
      spaces[space]=(spaces[space]??0)+1;
    }
    console.log(JSON.stringify({status:last.status,pc:last.pc??null,
      frame:board.state.frame,blocks:compiled,cycle:board.state.C,
      attempts:attempts+1,spaces}));
    break;
  }
  const pc=last.pc;
  let seed;
  if(pc<0x3000){
    const {bytes,known}=board.state.ramBytes(0,0x3000);
    const id=code.ramOverlays.findIndex(ov=>pc>=ov.start&&
      pc<ov.start+ov.bytes.length&&ov.bytes.every((v,i)=>
        known[ov.start+i]===255&&bytes[ov.start+i]===v));
    seed=id<0?null:view.at(pc,null,id);
  }else seed=view.at(pc,board.state.bank);
  if(!seed)throw Error('RP2_MISS_UNMAPPED');
  seeds.push(seed);
}
if(attempts===256)throw Error('RP2_DISCOVERY_LIMIT');
if(last.status==='FRAMES_DONE'){
  const {blocks:originalBlocks}=await import(pathToFileURL(join(bundle,'program.mjs')).href);
  const {createBoard:createOriginal}=await import(pathToFileURL(join(bundle,'gngb_runtime.mjs')).href);
  const run=(create,functions)=>{
    const hashes=[];
    const board=create(code,functions,{frames,portRead:portRead(),onFrame:r=>{
      hashes.push(createHash('sha256').update(r.record).update(r.known).digest('hex'));
      board.state.records[r.index-1]=null;
    }});
    const result=board.run();
    if(result.status!=='FRAMES_DONE')throw Error('RP2_COMPARE_RUN_'+result.status);
    const $=board.state;
    return {hashes,events:$.events,cycle:$.C,
      registers:Object.fromEntries(['a','b','dp','x','y','u','s','cc','PC',
        'ka','kb','kdp','kx','ky','ku','ks','kcc','frame','bank'].map(k=>[k,$[k]]))};
  };
  const a=run(createOriginal,originalBlocks),b=run(createBoard,blocks);
  if(JSON.stringify(a)!==JSON.stringify(b)){
    const field=Object.keys(a).find(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));
    throw Error('RP2_COMPILED_DIFFERENCE_'+field);
  }
  console.log(JSON.stringify({compiledEquivalent:true,frames,blocks:compiled,
    frameSequenceSha256:createHash('sha256').update(JSON.stringify(b.hashes)).digest('hex')}));
}
