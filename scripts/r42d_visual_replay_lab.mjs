#!/usr/bin/env node
/**
 * R4.2.D ROM-free deterministic checkpoint replay / divergence demonstrator.
 * Generates exclusively synthetic pixels and aggregate SHA-256 reports.
 * No MAME / proprietary ROM / native frame / MC6809 execution.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeR42dLabFixture} from '../src/gngb_visual_event_fixture.mjs';
import {replayGngbVisualEvents,compareGngbVisualReplays}
  from '../src/gngb_visual_event_replay.mjs';

const DEFAULT='out/r3/r42d-event-replay';
export function runR42dLab(){
  const src=makeR42dLabFixture();
  const baseline=replayGngbVisualEvents(src);
  const repeat=replayGngbVisualEvents(makeR42dLabFixture());
  const identical=compareGngbVisualReplays(baseline,repeat);
  if(identical.status!=='IDENTICAL_SYNTHETIC_REPLAY')
    throw Error('R42D_LAB_REPEAT_NOT_DETERMINISTIC');
  const changed={...src,events:src.events.map(e=>({...e}))};
  const tamper=changed.events.find(e=>e.kind==='WRITE8'&&e.address===0x1e03&&e.value===132);
  if(!tamper)throw Error('R42D_LAB_EXPECTED_SPRITE_EVENT_MISSING');
  tamper.value=136;
  const mutated=replayGngbVisualEvents(changed);
  const diff=compareGngbVisualReplays(baseline,mutated);
  if(diff.status!=='SYNTHETIC_REPLAY_DIVERGENCE'||
     diff.first_event_divergence?.seq!==tamper.seq||
     diff.first_frame_divergence?.checkpoint_id!=='second-dma')
    throw Error('R42D_LAB_FIRST_DIVERGENCE_UNEXPECTED');
  const checkpoints=baseline.checkpoints.map(x=>({
    id:x.id,seq:x.seq,frame_sha256:x.frame_sha256,
    video_ram_sha256:x.video_ram_sha256,
    buffered_sprite_sha256:x.buffered_sprite_sha256,
    palette_sha256:x.palette_sha256,scroll:{...x.scroll}
  }));
  const report={
    schema:'gng.r42.visual-lab-report.v1',
    status:'ROM_FREE_REPLAY_AND_DIVERGENCE_LAB_PASS',
    events:baseline.event_count,
    checkpoints:baseline.checkpoint_count,
    frames:checkpoints,
    repeat_comparison:identical,
    intentional_mutation_comparison:diff,
    native_mame_trace_consumed:false,
    native_vblank_correlated:false,
    native_pixel_equivalence_verified:false,
    autonomous_cpu_frame_rendered:false,
    game_playable:false,
  };
  return {baseline,report};
}
export function visualPage(baseline,report){
  const frames=baseline.checkpoints.map(c=>({
    id:c.id,rgba:Buffer.from(c.rgba).toString('base64')
  }));
  const payload=JSON.stringify(frames);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GNG R4.2.D · Event replay ROM-free</title>
<style>
body{max-width:1190px;margin:auto;padding:24px;font:15px system-ui;background:#131b29;color:#e8f0fc}
h1{font-size:28px}p{line-height:1.55;color:#c3d0e2}
.notice{background:#342b30;border-left:4px solid #e3b96e;padding:14px;color:#fff0dd}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
figure{margin:0;border:1px solid #4a5872;padding:10px;border-radius:9px}
canvas{width:100%;image-rendering:pixelated;background:#000}
figcaption{margin-top:8px;overflow-wrap:anywhere}
small{color:#bbcce2}
</style></head><body>
<h1>R4.2.D · Checkpoints de vídeo deterministas</h1>
<p class="notice"><strong>PRUEBA SINTÉTICA. NO ES UNA PANTALLA REAL DEL JUEGO.</strong>
Sin ROM, MAME, temporización nativa ni CPU original recompilada autónoma.</p>
<p>La RAM CPU cambia antes del segundo DMA, pero el sprite permanece congelado
hasta transferir el buffer. Luego se aplica una modificación de paleta y scroll.
Los cinco lienzos utilizan el compositor compartido R1 y estado de la board.</p>
<div class="grid" id="frames"></div>
<p>Comparación repetida: <strong>${report.repeat_comparison.status}</strong>.
Primer checkpoint divergente con evento modificado:
<strong>${report.intentional_mutation_comparison.first_frame_divergence.checkpoint_id}</strong>.</p>
<script>
const frames=${payload};
const root=document.getElementById('frames');
for(const item of frames){
 const fig=document.createElement('figure'),c=document.createElement('canvas');
 c.width=256;c.height=224;
 const caption=document.createElement('figcaption');
 caption.textContent=item.id;
 fig.append(c,caption);root.append(fig);
 const ascii=atob(item.rgba),data=new Uint8ClampedArray(ascii.length);
 for(let i=0;i<ascii.length;i++)data[i]=ascii.charCodeAt(i);
 const ctx=c.getContext('2d');const image=ctx.createImageData(256,224);
 image.data.set(data);ctx.putImageData(image,0,0);
}
</script></body></html>`;
}
async function main(){
  const args=process.argv.slice(2),index=args.indexOf('--out');
  if(index>=0&&!args[index+1])throw Error('R42D_OUT_ARGUMENT_REQUIRED');
  const out=resolve(index<0?DEFAULT:args[index+1]),privateRoot=resolve('out/r3');
  const rel=relative(privateRoot,out);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R42D_PRIVATE_OUTPUT_REQUIRED');
  const {baseline,report}=runR42dLab();
  await mkdir(out,{recursive:true});
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(out,'checkpoints.html'),visualPage(baseline,report));
  console.log(JSON.stringify({...report,frames:report.frames.map(x=>({
    id:x.id,seq:x.seq,frame_sha256:x.frame_sha256
  }))},null,2));
  console.log('R42D_VISUAL_HTML='+join(out,'checkpoints.html'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(err=>{console.error('R42D_LAB_BLOCKED '+err.message);process.exitCode=2;});
