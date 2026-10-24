#!/usr/bin/env node
/**
 * R4.2.B ROM-free visual checkpoint. Deliberately synthetic ROM graphics,
 * RAM and palette. NEVER represents a game frame or native MAME evidence.
 * Uses the same pixel compositor as R1 (not a hand-painted HTML scene).
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createGngbBoardMemory} from '../src/gngb_board_memory.mjs';
import {renderGngbBoardFrame} from '../src/gngb_frame_pipeline.mjs';

export function makeR42Fixture(){
  const board=createGngbBoardMemory();
  for(let addr=0x2000;addr<=0x2fff;addr++)board.write8(addr,0);
  for(let addr=0x1e00;addr<=0x1fff;addr++)board.write8(addr,0xf8);
  board.write8(0x1e00,0);board.write8(0x1e01,0);
  board.write8(0x1e02,82);board.write8(0x1e03,34);
  const chars=new Uint8Array(0x4000);chars.fill(0xff);
  const tiles=new Uint8Array(0x18000),sprites=new Uint8Array(0x20000);
  sprites.fill(0xff);sprites.fill(0,0,64);sprites.fill(0,0x10000,0x10040);
  const palette=new Uint8Array(0x400);
  for(let i=0;i<256;i++){
    palette[4*i]=(i*7)&255;
    palette[4*i+1]=(i*5)&255;
    palette[4*i+2]=(i*3)&255;
    palette[4*i+3]=255;
  }
  return {board,chars,tiles,sprites,palette,scroll:{x:0,y:0}};
}
export function renderR42FixturePair(){
  const fixture=makeR42Fixture();
  const {board,...assets}=fixture;
  board.write8(0x3c00,0); // first DMA
  const before=renderGngbBoardFrame({board,...assets});
  board.write8(0x1e03,132); // CPU write NOT yet presented on screen
  const frozen=renderGngbBoardFrame({board,...assets});
  if(!before.rgba.every((value,i)=>value===frozen.rgba[i]))
    throw Error('R42_DMA_FREEZE_VISUAL_INVARIANT_FAILED');
  board.write8(0x3c00,0); // second DMA
  const after=renderGngbBoardFrame({board,...assets});
  let changed=0;
  for(let i=0;i<before.rgba.length;i+=4)
    if(before.rgba[i]!==after.rgba[i]||
       before.rgba[i+1]!==after.rgba[i+1]||
       before.rgba[i+2]!==after.rgba[i+2]||
       before.rgba[i+3]!==after.rgba[i+3])changed++;
  if(changed<1)throw Error('R42_NO_VISIBLE_DMA_DELTA');
  const hash=frame=>createHash('sha256').update(frame.rgba).digest('hex');
  return {before,after,report:{
    schema:'gng.r42.synthetic-visual-checkpoint.v1',
    status:'LAB_SYNTHETIC_VISUAL_DMA_ISOLATION_PASS',
    width:before.width,height:before.height,
    changed_rgba_pixels:changed,
    initial_frame_sha256:hash(before),
    after_dma_frame_sha256:hash(after),
    dma_writes_observed_on_synthetic_board:2,
    cpu_writes_without_dma_do_not_affect_pixels:true,
    real_rom_or_mame_used:false,
    original_game_logic_running:false,
    native_pixel_equivalence_verified:false,
    autonomous_cpu_frame_rendered:false,
    game_playable:false
  }};
}
export function fixtureHtml({before,after,report}){
  const data=JSON.stringify({
    before:Buffer.from(before.rgba).toString('base64'),
    after:Buffer.from(after.rgba).toString('base64')
  });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>R4.2.B — Prueba DMA sintética</title>
<style>body{font:16px system-ui;background:#151b27;color:#f4f6fa;padding:20px;max-width:980px;margin:auto}
section{display:flex;flex-wrap:wrap;gap:18px}figure{margin:0;flex:1 1 310px}
canvas{width:100%;image-rendering:pixelated;background:#000;border:1px solid #687184}
p{line-height:1.5;color:#c9d3e0}.status{padding:12px;background:#303440;border-left:4px solid #d4bd72}
</style></head><body>
<h1>R4.2.B · Board → buffer DMA → píxeles</h1>
<p class="status"><strong>PRUEBA SINTÉTICA — NO ES UN FOTOGRAMA DEL JUEGO.</strong>
Sin ROM propietaria, sin MAME y sin ejecución autónoma MC6809.</p>
<p>Ambas imágenes usan el mismo compositor de R1; solo cambia el estado
del buffer después de una escritura explícita en 0x3C00.
Las escrituras intermedias en RAM CPU no modificaron los píxeles.</p>
<section><figure><canvas id="before" width="256" height="224"></canvas>
<figcaption>Antes del segundo DMA</figcaption></figure>
<figure><canvas id="after" width="256" height="224"></canvas>
<figcaption>Después del segundo DMA</figcaption></figure></section>
<p>Píxeles RGBA diferentes: <strong>${report.changed_rgba_pixels}</strong>.
Validación nativa pendiente.</p>
<script>
const payload=${data};
for(const [key,blob] of Object.entries(payload)){
 const bytes=atob(blob),rgba=new Uint8ClampedArray(bytes.length);
 for(let i=0;i<bytes.length;i++)rgba[i]=bytes.charCodeAt(i);
 const ctx=document.getElementById(key).getContext('2d');
 const image=ctx.createImageData(256,224);
 image.data.set(rgba);ctx.putImageData(image,0,0);
}
</script></body></html>`;
}
async function main(){
  const args=process.argv.slice(2);
  const idx=args.indexOf('--out');
  const out=resolve(idx<0?'out/r3/r42-visual-fixture/compare.html':args[idx+1]);
  const rel=relative(resolve('out/r3'),out);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R42_PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
  const pair=renderR42FixturePair();
  await mkdir(resolve(out,'..'),{recursive:true});
  await writeFile(out,fixtureHtml(pair));
  await writeFile(resolve(out,'../report.json'),JSON.stringify(pair.report,null,2)+'\n');
  console.log(JSON.stringify(pair.report,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(err=>{console.error('R42_VISUAL_LAB=BLOCKED '+err.message);process.exitCode=2;});
