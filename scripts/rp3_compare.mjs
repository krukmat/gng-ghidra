#!/usr/bin/env node
/** Private RP-3 comparison: pinned AOT input, old board/audio, composition
 * and a native CPU/Z80/YM restore. Writes hashes and counts only under out/.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {createBoard as createOld} from '../src/gngb_runtime.mjs';
import {createGngSession} from '../boards/gng/index.mjs';
import {mapGngFrozenBlocks} from '../boards/gng/code-view.mjs';
import {createAudioCommandSource,applyCommand} from '../src/ao_audio_commands.mjs';
import {loadYm2203} from '../src/ao_ym2203_wasm.mjs';
import {liveTapeReader,LIVE_TAPE_SCHEMA} from '../src/v3_b3_live_tape.mjs';
import {CYCLES_PER_FRAME} from '../boards/gng/runtime.mjs';

const [bundleArg,referenceArg,romArg,wasmArg,framesArg,reportArg,
  scenario='idle',tapeArg]=process.argv.slice(2);
if(!bundleArg||!referenceArg||!romArg||!wasmArg||!framesArg||!reportArg)
  throw Error('RP3_USAGE: bundle reference sound-rom wasm frames private-report [idle|tape tape-file]');
const report=resolve(reportArg),frames=Number(framesArg);
if(!report.startsWith(resolve('out')+'/')||!Number.isInteger(frames)||
   frames<2||frames>6000||!['idle','tape'].includes(scenario)||
   (scenario==='tape'&&!tapeArg))throw Error('RP3_ARGUMENT_INVALID');
const bundle=resolve(bundleArg),reference=JSON.parse(readFileSync(resolve(referenceArg)));
const {manifest,code}=loadFrozen(bundle);
const sha=b=>createHash('sha256').update(b).digest('hex');
if(frames>manifest.frames||reference.inputs.bundle.path!==bundle||
   Object.entries(reference.inputs.bundle.files).some(([name,item])=>{
     const bytes=readFileSync(join(bundle,name));
     return bytes.length!==item.bytes||sha(bytes)!==item.sha256;
   })||sha(readFileSync(reference.inputs.romZip.path))!==
     reference.inputs.romZip.sha256)
  throw Error('RP3_REFERENCE_MISMATCH');
const rom=new Uint8Array(readFileSync(resolve(romArg))),
  wasm=new Uint8Array(readFileSync(resolve(wasmArg)));
const soundRegion=JSON.parse(readFileSync(resolve('out/base-reference/rp1-v4/migration.json')))
  .binary.regions.find(x=>x.id==='gg2');
if(!soundRegion||rom.length!==soundRegion.bytes||sha256Bytes(rom)!==soundRegion.sha256||
   wasm.length!==reference.inputs.ym2203Wasm.bytes||
   sha256Bytes(wasm)!==reference.inputs.ym2203Wasm.sha256)
  throw Error('RP3_PRIVATE_INPUT_MISMATCH');
const tape=scenario==='tape'?JSON.parse(readFileSync(resolve(tapeArg))):null;
if(tape&&(tape.schema!==LIVE_TAPE_SCHEMA||
   tape.program_sha256!==manifest.files['program.mjs']))throw Error('RP3_TAPE_MISMATCH');
const portRead=()=>tape?liveTapeReader(tape.changes):null;
const {blocks}=await import(pathToFileURL(join(bundle,'program.mjs')).href);
const converted=mapGngFrozenBlocks(code,blocks);
function sha256Bytes(b){return createHash('sha256').update(b).digest('hex');}
const frameHash=r=>sha(Buffer.concat([Buffer.from(r.record),Buffer.from(r.known),
  Buffer.from(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]))]));
const pcmHash=p=>sha(Buffer.from(p.samples.buffer,p.samples.byteOffset,p.samples.byteLength));
const oldFrames=[],oldPcm=[];
const source=await createAudioCommandSource(rom),ym=(await loadYm2203(wasm)).create();
let events=[],audioFrames=0;
const old=createOld(code,blocks,{frames,portRead:portRead(),
  onFrame:r=>{oldFrames.push(frameHash(r));old.state.records[r.index-1]=null;},
  onAudioEvent:e=>events.push({kind:e.kind,value:e.value,cycle:e.cycle}),
  onAudioComplete:m=>{
    if(m.frames<=audioFrames)return;
    const {commands}=source.batch(m.frames*CYCLES_PER_FRAME,events);events=[];
    for(const c of commands){const b=applyCommand(ym,c);if(b)oldPcm.push([b.firstSample,pcmHash(b)]);}
    audioFrames=m.frames;
  }});
if(old.run().status!=='FRAMES_DONE'||audioFrames!==frames)throw Error('RP3_OLD_STOP');
ym.destroy();
const newFrames=[],newPcm=[];
const make=checkpoint=>createGngSession({code,blocks:converted,
  soundRom:rom,wasm,frames,portRead:portRead(),checkpoint,
  onFrame:r=>{newFrames.push(frameHash(r));},
  onPcm:p=>newPcm.push([p.sampleStart,pcmHash(p)])});
const fresh=await make(null);
if(fresh.runUntilFrame(frames).status!=='FRAMES_DONE')throw Error('RP3_FRESH_STOP');
const freshState=fresh.snapshot();fresh.close();
const cut=Math.floor(frames/2),head=await make(null);
if(head.runUntilFrame(cut).status!=='FRAMES_DONE')throw Error('RP3_CUT_STOP');
const checkpoint=head.exportState();head.close();
const tail=await make(checkpoint);
if(tail.runUntilFrame(frames).status!=='FRAMES_DONE')throw Error('RP3_RESTORE_STOP');
const tailState=tail.snapshot();tail.close();
const same=(a,b,what)=>{if(JSON.stringify(a)!==JSON.stringify(b))
  throw Error('RP3_MISMATCH '+what+' '+a.length+'/'+b.length);};
same(oldFrames,newFrames.slice(0,frames),'frames-old-new');
same(oldPcm,newPcm.slice(0,frames),'pcm-old-new');
same(newFrames.slice(0,frames),newFrames.slice(frames),'frames-restore');
same(newPcm.slice(0,frames),newPcm.slice(frames),'pcm-restore');
if(freshState.cycle!==tailState.cycle)throw Error('RP3_CYCLE_MISMATCH');
const result={schema:'rom-migration.rp3.compare.v1',scenario,frames,
  bundleProgramSha256:manifest.files['program.mjs'],
  frameSequenceSha256:sha(JSON.stringify(oldFrames)),
  pcmSequenceSha256:sha(JSON.stringify(oldPcm)),
  pcmBlocks:oldPcm.length,cut,cycle:freshState.cycle,equivalent:true};
writeFileSync(report,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));
