#!/usr/bin/env node
/** R4.2.H ROM-free terminal gate: no ROM, MAME, network or GitHub Actions.
 * Reports aggregates only, never dumps framebuffer or event bytes.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {runR42hCase,runR42hDiagnostic,R42H_SIZES}
  from '../src/r42h_romfree_gate.mjs';

export async function runR42hGate({scale=false,count=5000}={}){
  if(typeof scale!=='boolean'||!R42H_SIZES.includes(count))
    throw Error('R42H_GATE_ARGUMENT_INVALID');
  const diagnostic=await runR42hDiagnostic({count:5000});
  const sizes=scale?R42H_SIZES:[count];
  const runs=[];
  for(const size of sizes){
    const before=process.memoryUsage().heapUsed,start=performance.now();
    const single=await runR42hCase({count:size});
    const duration_ms=Math.round(performance.now()-start);
    runs.push({
      event_count:size,
      window_count:single.core.window_count,
      processing_ms:duration_ms,
      heap_change_mib:Math.round((process.memoryUsage().heapUsed-before)/1048576*100)/100,
      state_sha256:single.core.frame_sha256,
      state:'SYNTHETIC_E2E_COMPONENTS_VERIFIED',
      native_proof:false
    });
  }
  return {
    schema:'gng.r42h.romfree-checkpoint.v1',
    status:'ROM_FREE_LAB_GATE_PASS_NATIVE_UNVERIFIED',
    diagnostic,
    scales:runs,
    million_event_stress_required:false,
    github_actions_used:false,
    mame_executed:false,
    node_python_whole_suite_verified:false,
    autonomous_cpu_frame_rendered:false
  };
}
function privateOutput(p){
  const root=resolve('out'),out=resolve(p),r=relative(root,out);
  if(!r||r==='..'||r.startsWith('../')||isAbsolute(r))
    throw Error('R42H_PRIVATE_OUTPUT_REQUIRED');
  return out;
}
async function main(){
  const args=process.argv.slice(2);
  let scale=false,count=5000,out='out/r3/r42h-romfree-checkpoint.json';
  for(let i=0;i<args.length;i++){
    if(args[i]==='--scale')scale=true;
    else if(args[i]==='--events'){
      if(!args[i+1])throw Error('R42H_EVENTS_ARGUMENT_REQUIRED');
      count=Number(args[++i]);
    }else if(args[i]==='--out'){
      if(!args[i+1])throw Error('R42H_OUT_ARGUMENT_REQUIRED');
      out=args[++i];
    }else throw Error('R42H_UNKNOWN_ARGUMENT');
  }
  const output=privateOutput(out);
  const report=await runR42hGate({scale,count});
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({
    status:report.status,scales:report.scales.map(x=>({
      event_count:x.event_count,window_count:x.window_count,
      processing_ms:x.processing_ms,heap_change_mib:x.heap_change_mib
    })),first_divergence:report.diagnostic.changed.first_pixel_divergence,
    after_dma_no_visible_change:report.diagnostic.post_dma_write.equal_components.pixels,
    native_proof:false,
    output
  },null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('R42H_GATE_BLOCKED '+e.message);process.exitCode=2;});
