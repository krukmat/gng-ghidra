#!/usr/bin/env node
/** Private RP-4 comparison: the bundle built by the base chain from the
 * original ZIP against the certified g6 bundle. Same code image, overlays and
 * block identities, and the same frames for no input and every B3 tape
 * (g6 on its own runtime, the new bundle on boards/gng). Writes hashes and
 * counts only under out/.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {readBundle} from '../base/src/build/bundle.mjs';
import {gngCode} from '../boards/gng/bundle.mjs';
import {mapGngFrozenBlocks} from '../boards/gng/code-view.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {B3_PROFILES,B3_HORIZONS,b3Tape} from '../src/v3_b3_tapes.mjs';

const [referenceArg,bundleArg,reportArg,framesArg]=process.argv.slice(2);
if(!referenceArg||!bundleArg||!reportArg)
  throw Error('RP4_USAGE: g6-frozen new-bundle private-report [max-frames]');
const report=resolve(reportArg),maxFrames=Number(framesArg??6000);
if(!report.startsWith(resolve('out')+'/')||!Number.isInteger(maxFrames)||maxFrames<1)
  throw Error('RP4_ARGUMENT_INVALID');
const fail=code=>{throw Error('RP4_'+code);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const g6=loadFrozen(resolve(referenceArg));
const fresh=readBundle(resolve(bundleArg));
const code=gngCode(fresh.manifest,fresh.files['code.bin'],fresh.files['overlays.bin']);
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
if(!same(code.fixed,g6.code.fixed)||!same(code.banks,g6.code.banks))fail('CODE_IMAGE');
if(code.ramOverlays.length!==g6.code.ramOverlays.length||
   code.ramOverlays.some((ov,i)=>ov.start!==g6.code.ramOverlays[i].start||
     !same(ov.bytes,g6.code.ramOverlays[i].bytes)))fail('OVERLAYS');
const {blocks:oldBlocks}=await import(pathToFileURL(join(resolve(referenceArg),'program.mjs')).href);
const {blocks:newBlocks}=await import(pathToFileURL(join(resolve(bundleArg),'program.mjs')).href);
const oldIds=[...mapGngFrozenBlocks(g6.code,oldBlocks).keys()].sort(),
  newIds=[...newBlocks.keys()].sort();
if(JSON.stringify(oldIds)!==JSON.stringify(newIds))
  fail('BLOCK_IDENTITIES '+oldIds.length+'/'+newIds.length);
const {createBoard:createOld}=await import(pathToFileURL(
  join(resolve(referenceArg),'gngb_runtime.mjs')).href);
const frameHash=r=>sha(Buffer.concat([Buffer.from(r.record),Buffer.from(r.known),
  Buffer.from(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]))]));
function run(create,c,blocks,frames,tape){
  const hashes=[];
  const board=create(c,blocks,{frames,portRead:tape?(a,cycle)=>tape.read(a,cycle):undefined,
    onFrame:r=>{hashes.push(frameHash(r));board.state.records[r.index-1]=null;}});
  const r=board.run();
  return {status:r.status,cycle:board.state.C,sequence:sha(hashes.join('\n')),frames:hashes.length};
}
const scenarios=B3_PROFILES.map(p=>[p,b3Tape(p)]); // 'idle' has no input
const results={};
for(const [name,tape] of scenarios){
  const frames=Math.min(maxFrames,B3_HORIZONS[name]);
  const a=run(createOld,g6.code,oldBlocks,frames,tape);
  const b=run(createBoard,code,newBlocks,frames,tape);
  if(a.status!=='FRAMES_DONE'||JSON.stringify(a)!==JSON.stringify(b))
    fail('RUN_MISMATCH '+name+' '+JSON.stringify([a,b]));
  results[name]=a;
  console.log('RP4_'+name+'=PASS_'+frames+'_FRAMES_IDENTICAL');
}
const out={schema:'gng.rp4.compare.v1',reference:resolve(referenceArg),
  reference_program_sha256:g6.manifest.files['program.mjs'],
  bundle:resolve(bundleArg),bundle_program_sha256:fresh.manifest.files['program.mjs'],
  codeImageEqual:true,overlaysEqual:true,blockIdentities:newIds.length,
  functions:{reference:null,bundle:fresh.manifest.program.functions},
  scenarios:results,equivalent:true};
writeFileSync(report,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('RP4_COMPARE=PASS '+report);
