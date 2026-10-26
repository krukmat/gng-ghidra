#!/usr/bin/env node
/**
 * R3.5.B2.T5 phases C/D driver. Compiles gngb MC6809 code ahead of time
 * from the private ROM, runs it from a cold reset with no oracle input,
 * then compares (after the run) native IRQ/SYNC event cycles and every
 * VBLANK frame record against the private T4.3 reference, and renders
 * matching frames for a pixel diff against MAME's PNG.
 *
 * Entry discovery: the compiler follows direct control flow from the
 * reset/IRQ vectors; a dynamic jump to code not yet compiled stops the
 * run with UNCOMPILED (bank, pc). That PC is added to the seed list, the
 * program is recompiled from ROM, and the run restarts from reset.
 * Prints counts and fixed statuses only; details stay in out/r35/t5/.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {createBoard,gngbCodeImage,GngbRuntimeError,RECORD_BYTES,CYCLES_PER_FRAME}
  from '../src/gngb_runtime.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {decodePng,diffRgba,gngbGraphics,rendererInputs} from './r35_t5_render_check.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
export const FIELDS=[['ram',0,0x1e00],['sprites',0x1e00,0x200],['buffered',0x2000,0x200],
  ['fg',0x2200,0x800],['bg',0x2a00,0x800],['palette_ext',0x3200,0x100],
  ['palette',0x3300,0x100],['rgba',0x3400,0x400]];

export function parseNativeEvents(text){
  const out=[];
  for(const line of text.split('\n')){
    const i=line.indexOf('GNG_R35_NATIVE_V1\t');
    if(i<0)continue;
    const f=line.slice(i).split('\t').slice(1);
    const hex=v=>parseInt(v,16),num=Number;
    switch(f[0]){
      case 'CPU_RESET':out.push(['CPU_RESET',num(f[1])]);break;
      case 'VECTOR_FETCH':out.push(['VECTOR_FETCH',hex(f[1]),hex(f[2]),num(f[3])]);break;
      case 'SYNC_ENTER':out.push(['SYNC_ENTER',hex(f[1]),hex(f[2]),num(f[3])]);break;
      case 'SYNC_EXIT':out.push(['SYNC_EXIT',hex(f[1]),hex(f[2]),num(f[3]),num(f[4]),num(f[5]),num(f[6])]);break;
      case 'LINE_DELIVERED':out.push(['LINE_DELIVERED',f[1],num(f[2]),num(f[5])]);break;
      case 'IRQ_ENTRY':out.push(['IRQ_ENTRY',f[1],hex(f[2]),hex(f[3]),num(f[4])]);break;
      default:throw Error('R35_T5_NATIVE_EVENT_KIND');
    }
  }
  return out;
}

/** Per-kind comparison; SYNC events are compared up to the native cap. */
export function compareEvents(ours,native,lastCycle){
  const cyc=e=>e[e.length-1];
  const sel=(list,kind)=>list.filter(e=>e[0]===kind&&cyc(e)<=lastCycle);
  const report={};
  for(const kind of ['CPU_RESET','VECTOR_FETCH','LINE_DELIVERED','IRQ_ENTRY','SYNC_ENTER','SYNC_EXIT']){
    const a=sel(ours,kind),b=sel(native,kind);
    const capped=kind.startsWith('SYNC_');
    const n=capped?Math.min(a.length,b.length):Math.max(a.length,b.length);
    let first=capped&&a.length<b.length
      ?{i:a.length,ours:null,native:b[a.length]}:null;
    if(capped&&b.length===0&&a.length>0)
      first={i:0,ours:a[0],native:null};
    for(let i=0;i<n;i++){
      if(JSON.stringify(a[i])!==JSON.stringify(b[i])){first={i,ours:a[i]??null,native:b[i]??null};break;}
    }
    report[kind]={ours:a.length,native:b.length,compared:n,first_divergence:first};
  }
  return report;
}

export function compareRecord(ours,ref,meta){
  const fields={};
  let mismatch=0,unknown=0;
  for(const [name,off,len] of FIELDS){
    let m=0,u=0,first=null;
    for(let i=off;i<off+len;i++){
      if(ours.known[i]!==255){u++;continue;}
      if(ours.record[i]!==ref[i]){m++;if(first===null)first=i-off;}
    }
    fields[name]={mismatch:m,unknown:u,first};
    mismatch+=m;unknown+=u;
  }
  const metaDiff=[];
  const same=(k,x,y)=>{if(JSON.stringify(x)!==JSON.stringify(y))metaDiff.push(k);};
  same('scroll',ours.scroll,meta.scroll.map(v=>v??0));
  same('bank',ours.bank,meta.bank);
  same('latch',ours.latch,meta.latch.map(v=>v===null?null:v&1));
  same('sprite_buffer_valid',ours.sprite_buffer_valid,meta.sprite_buffer_valid);
  for(const k of ['dma','scroll','bank','latch'])
    same(k+'_writes',ours.writes[k],meta[k+'_writes']);
  return {mismatch,unknown,fields,metaDiff};
}

const $state=board=>board.state;
/** ROM bytes at {bank|null, addr} (bank null = fixed region). */
export function romBytes(code,origin,n){
  const out=new Uint8Array(n);
  for(let i=0;i<n;i++){
    const a=origin.addr+i;
    out[i]=a>=0x6000||origin.bank===null?code.fixed[a]:code.banks[origin.bank*0x2000+a-0x4000];
  }
  return out;
}
/** Longest RAM run from pc that occurs exactly once in ROM (>= 16 bytes). */
export function locateRamCode(code,$,pc){
  const {bytes,known}=$.ramBytes(pc,0x3000-pc);
  let n=0;while(n<bytes.length&&known[n]===255)n++;
  const spaces=[{bank:null,base:0x6000,data:code.fixed.subarray(0x6000)}];
  for(let b=0;b<5;b++)spaces.push({bank:b,base:0x4000,data:code.banks.subarray(b*0x2000,(b+1)*0x2000)});
  let best=null,ties=0;
  for(const sp of spaces){
    for(let o=0;o<sp.data.length;o++){
      let m=0;while(m<n&&o+m<sp.data.length&&sp.data[o+m]===bytes[m])m++;
      if(m<16)continue;
      if(!best||m>best.length){best={start:pc,origin:{bank:sp.bank,addr:sp.base+o},length:m};ties=0;}
      else if(m===best.length)ties++;
    }
  }
  return best&&!ties?best:null;
}

async function main(){
  const args=process.argv.slice(2);
  const frames=Number(args[0]??600);
  const refDir=resolve(ROOT,'out/r35/t43-ref'),outDir=resolve(ROOT,'out/r35/t5');
  mkdirSync(outDir,{recursive:true});
  const zip=resolve(ROOT,'roms/gng.zip');
  const read=n=>execFileSync('unzip',['-p',zip,n],{maxBuffer:1<<20});
  const code=gngbCodeImage(read);
  const seedFile=resolve(outDir,'seeds.json');
  const vec=a=>code.fixed[a]<<8|code.fixed[a+1];
  let seeds=existsSync(seedFile)?JSON.parse(readFileSync(seedFile,'utf8')):[];
  const ovFile=resolve(outDir,'ram-overlays.json');
  const overlays=existsSync(ovFile)?JSON.parse(readFileSync(ovFile,'utf8')):[];
  code.ramOverlays=overlays.map(o=>({start:o.start,bytes:romBytes(code,o.origin,o.length)}));
  const base=[{bank:null,pc:vec(0xfffe)},{bank:null,pc:vec(0xfff8)}];
  const libUrl=pathToFileURL(resolve(ROOT,'src/mc6809_aot_lib.mjs')).href;
  let board,result,iter=0,compiled;
  for(;;){
    iter++;
    compiled=compileProgram(code,[...base,...seeds],{libUrl});
    const modPath=resolve(outDir,`aot-generated.mjs`);
    writeFileSync(modPath,compiled.source);
    const {blocks}=await import(pathToFileURL(modPath).href+'?v='+iter);
    board=createBoard(code,blocks,{frames});
    try{result=board.run();}
    catch(e){
      if(!(e instanceof GngbRuntimeError))throw e;
      result={status:'BLOCKED',code:e.code,...e.detail};
    }
    if(result.status==='RAM_CODE_UNMAPPED'&&iter<=2000){
      // Locate the ROM origin of the RAM-resident code and compile it
      // from those ROM bytes; the board checks RAM equals them at entry.
      const ov=locateRamCode(code,$state(board),result.pc);
      if(!ov){result={status:'BLOCKED',code:'R35_T5_RAM_CODE_ORIGIN_UNKNOWN',pc:result.pc};break;}
      overlays.push(ov);
      writeFileSync(ovFile,JSON.stringify(overlays)+'\n');
      code.ramOverlays=overlays.map(o=>({start:o.start,bytes:romBytes(code,o.origin,o.length)}));
      seeds.push({bank:null,pc:result.pc,overlay:overlays.length-1});
      writeFileSync(seedFile,JSON.stringify(seeds)+'\n');
      continue;
    }
    if(result.status!=='UNCOMPILED'||iter>2000)break;
    seeds.push({bank:result.bank,pc:result.pc,overlay:result.overlay??null});
    writeFileSync(seedFile,JSON.stringify(seeds)+'\n');
  }
  const $=board.state;
  const native=parseNativeEvents(readFileSync(resolve(refDir,'native-events.log'),'utf8'));
  const lastCycle=$.records.length*CYCLES_PER_FRAME-1;
  const events=compareEvents($.events,native,Math.min(lastCycle,$.C));
  const bin=readFileSync(resolve(refDir,'frames.bin'));
  const metas=readFileSync(resolve(refDir,'frames.jsonl'),'utf8').split('\n')
    .filter(Boolean).map(l=>JSON.parse(l));
  const gfx=gngbGraphics(read);
  const rows=[];
  for(const rec of $.records){
    const i=rec.index-1,meta=metas[i];
    const ref=bin.subarray(i*RECORD_BYTES,(i+1)*RECORD_BYTES);
    const cmp=compareRecord(rec,ref,meta);
    let pixels=null;
    // Pixels only for fully known, exact state: unknown bytes are not zero.
    if(cmp.mismatch===0&&cmp.unknown===0&&!cmp.metaDiff.length){
      // Render from OUR state (not the reference) and diff MAME's PNG.
      const ours=renderGngbRgba(rendererInputs(rec.record,
        {scroll:rec.scroll,latch:rec.latch},gfx));
      const png=decodePng(readFileSync(resolve(refDir,'png',
        `${String(meta.frame).padStart(4,'0')}.png`)));
      pixels=diffRgba(ours.rgba,png.rgba,png.width).count;
    }
    rows.push({index:rec.index,...cmp,pixels});
  }
  const stateExact=rows.filter(r=>r.mismatch===0&&r.unknown===0&&!r.metaDiff.length);
  const pixelExact=rows.filter(r=>r.pixels===0);
  const firstBad=rows.find(r=>r.mismatch>0||r.metaDiff.length);
  const report={schema:'gng.r35.t5-run.v1',result,iterations:iter,seeds:seeds.length,
    blocks:compiled.blockCount,frames_run:$.records.length,events,
    first_bad_frame:firstBad??null,
    state_exact:stateExact.map(r=>r.index),pixel_exact:pixelExact.map(r=>r.index),
    rows:rows.map(r=>({index:r.index,mismatch:r.mismatch,unknown:r.unknown,
      metaDiff:r.metaDiff,pixels:r.pixels,fields:r.mismatch||r.unknown?r.fields:undefined}))};
  writeFileSync(resolve(outDir,'report.json'),JSON.stringify(report,null,1)+'\n');
  const evOk=Object.values(events).every(e=>!e.first_divergence);
  console.log(`R35_T5_RUN=${result.status==='FRAMES_DONE'?'FRAMES_DONE':result.code??result.status}`);
  console.log(`R35_T5_COMPILE_ITERATIONS=${iter}`);
  console.log(`R35_T5_BLOCKS=${compiled.blockCount}`);
  console.log(`R35_T5_FRAMES_RUN=${$.records.length}`);
  console.log(`R35_T5_EVENTS=${evOk?'MATCH':'DIVERGED'}`);
  console.log(`R35_T5_STATE_EXACT_FRAMES=${stateExact.length}`);
  console.log(`R35_T5_PIXEL_EXACT_FRAMES=${pixelExact.length}`);
  console.log(`R35_T5_FIRST_BAD_FRAME=${firstBad?.index??'NONE'}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
