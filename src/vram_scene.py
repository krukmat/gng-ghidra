#!/usr/bin/env python3
"""V1.2 offline GNG BG/FG+sprites from verified private ROM gfx chips.

Builds an actual 2/3/4 bitplane Canvas renderer backed by the original
6809 hardware's tile/sprite RAM layout, plus controlled scroll registers.
The *memory fixture* and test palette are deliberately synthetic; no
gameplay, no in-game stage reconstruction, no CPU emulation.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path

from graphics_preview import load_regions
from sprite_scene import pick_sprites

SCHEMA="gng.vram-scene.v1"


def _bit(rom:bytes,at:int)->int:
    return (rom[at//8]>>(7-(at&7)))&1


def _pen(rom:bytes,kind:str,index:int,x:int,y:int)->int:
    if kind=="bg":
        off=index*256+y*8+(x if x<8 else 128+x-8)
        return (_bit(rom,off+0x10000*8) |
                _bit(rom,off+0x8000*8)<<1 |
                _bit(rom,off)<<2)
    if kind=="fg":
        off=index*128+y*16+(x if x<4 else x+4)
        return _bit(rom,off+4)|(_bit(rom,off)<<1)
    raise ValueError("Unknown tile graphics type")


def choose_tiles(region:bytes,kind:str,count:int=14)->list[int]:
    expected=0x18000 if kind=="bg" else 0x4000
    if len(region)!=expected:
        raise ValueError("Invalid original "+kind+" gfx region length")
    width=16 if kind=="bg" else 8
    # Rank ROM assets that have contrasting *real pixels*, rather than
    # guessing the identity or position of a game-level background.
    candidates=[]
    for index in range(1024):
        pixels=[_pen(region,kind,index,x,y)
                for y in range(width) for x in range(width)]
        distinct=len(set(pixels))
        from collections import Counter
        freq=Counter(pixels)
        main=freq.most_common(1)[0][1]
        nontrivial=width*width-main
        if kind=="bg":
            score=nontrivial+distinct*11
            keep=distinct>=3 and nontrivial>=45
        else:
            opaque=sum(p!=3 for p in pixels)
            score=distinct*30+opaque-(64 if opaque==64 else 0)
            keep=distinct>=2 and 10<=opaque<=56
        if keep:
            candidates.append((score,index))
    # Diversity of indices (avoid choosing near-identical adjacent code
    # points that are often animation slices). Never synthesize gfx data.
    candidates.sort(key=lambda row:(-row[0],row[1]))
    result=[]
    for _,index in candidates:
        if all(abs(index-other)>=6 for other in result):
            result.append(index)
            if len(result)==count:break
    if len(result)<count:
        for i in range(0,1024,13):
            if i not in result:result.append(i)
            if len(result)==count:break
    return result


HTML=r"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GNG V1.2 — Tilemap VRAM renderer</title>
<style>
:root{color-scheme:dark;background:#0b111f;color:#e7f0f9;font-family:system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 30% 0,#1d2d46 0,#0b111f 62%)}
main{max-width:1390px;margin:0 auto;padding:26px 18px 56px}
h1{font-size:clamp(25px,3.2vw,38px);margin:6px 0 10px;letter-spacing:-.035em}
.label{color:#8edbd0;font:bold 11px ui-monospace,monospace;letter-spacing:.13em}
.lead{font-size:14px;color:#bac9dd;line-height:1.6;max-width:1000px}
.warning{background:#30253b;border:1px solid #776088;color:#efe2f4;border-radius:9px;padding:12px 16px;font-size:13px;margin:19px 0}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}
.card{background:#111e31;border:1px solid #354762;border-radius:13px;padding:17px;min-width:0}
h2{font-size:19px;margin:4px 0 10px}.head{display:flex;justify-content:space-between;align-items:center;gap:10px}
canvas{display:block;width:100%;max-width:540px;aspect-ratio:256/240;margin:0 auto;background:#080e18;
 image-rendering:pixelated;image-rendering:crisp-edges;border:1px solid #374863;border-radius:5px}
button{border-radius:7px;border:1px solid #65a8a4;background:#204f55;color:#edf9f7;
 font:600 13px system-ui;cursor:pointer;padding:10px 13px}
button.secondary{background:#263950;border-color:#5b7190}
button:hover{filter:brightness(1.15)}
.controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-top:16px}
label{font:600 12px system-ui;color:#c3d2e8;display:grid;gap:5px}
input[type=range]{width:100%;accent-color:#7de1d3}
input[type=checkbox]{accent-color:#7de1d3}
.value{color:#8ee6d4;font-family:ui-monospace,monospace}
.desc{color:#a2b3cb;font-size:12px;line-height:1.5}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:17px}
.num{font:700 15px ui-monospace,monospace;color:#94e7d6}
table{width:100%;border-collapse:collapse;font:12px ui-monospace,monospace}
th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #2f405b}
th{color:#9cb6d1;font:700 11px system-ui}
.metric{display:flex;flex-wrap:wrap;gap:15px;align-items:center;margin:14px 0}
footer{font-size:12px;line-height:1.6;color:#97a9c6;margin-top:24px}
code{color:#f3ddaf}
@media(max-width:780px){.grid{grid-template-columns:1fr}}
</style></head>
<body><main>
<div class="label">V1.2 · VIDEORAM / TILEMAP / SCROLL</div>
<h1>Ghosts 'n Goblins — dos estados de memoria, dos imágenes</h1>
<p class="lead">Ahora el lienzo combina <strong>background 16×16</strong>, <strong>sprites 16×16</strong> y <strong>foreground 8×8</strong> usando los bitplanes originales de tus ROM. Cada tile sale de registros de memoria y el scroll usa los registros de la placa. Modifica bytes y compara el resultado.</p>
<div class="warning"><strong>ESCENA DIAGNÓSTICA, NO UNA PANTALLA DEL JUEGO.</strong> Los mapas y colores de esta demostración son fixtures configurados explícitamente. Los gráficos sí proceden de los chips ROM. Ni el flujo MC6809 ni la lógica de una partida están ejecutándose. Los colores son de inspección, no los RGB reales del arcade.</div>
<div class="grid">
<section class="card"><div class="head"><div><div class="label">ESTADO ORIGINAL · FIXTURE A</div><h2>ANTES</h2></div><button class="secondary" id="saveBefore">Guardar PNG</button></div>
<canvas id="before" width="256" height="240" aria-label="Escena VRAM original"></canvas>
<p class="desc">Scroll X=0, Y=0. Tilemap en RAM 0x2800–0x2fff; sprites bufferizados. No es un nivel extraído del juego.</p></section>
<section class="card"><div class="head"><div><div class="label">ESTADO MODIFICADO · FIXTURE B</div><h2>DESPUÉS</h2></div><button class="secondary" id="saveAfter">Guardar PNG</button></div>
<canvas id="after" width="256" height="240" aria-label="Escena VRAM modificada"></canvas>
<p class="desc">El scroll, un tile BG, un tile FG y la posición del sprite responden a cambios de memoria explícitos.</p></section>
</div>
<section class="card" style="margin-top:16px">
<div class="head"><h2>Manipular registros originales de vídeo</h2><span class="label">V1.2 · MEMORIA, NO CPU</span></div>
<div class="controls">
<label>Scroll horizontal X · 0x3B08/09 <span class="value" id="sxLabel"></span>
<input type="range" id="sx" min="0" max="511" step="8" value="72"></label>
<label>Scroll vertical Y · 0x3B0A/0B <span class="value" id="syLabel"></span>
<input type="range" id="sy" min="0" max="511" step="8" value="32"></label>
<label>Tile del escenario (BG) <span class="value" id="tileLabel"></span>
<input type="range" id="tile" min="0" max="1023" step="1" value="0"></label>
<label>Color de tile BG (grupo) <span class="value" id="colorLabel"></span>
<input type="range" id="color" min="0" max="7" step="1" value="3"></label>
<label>Posición X del sprite · RAM 0x1e03 <span class="value" id="spriteXLabel"></span>
<input type="range" id="spriteX" min="0" max="240" step="1" value="158"></label>
<label>Sprite ROM index <span class="value" id="spriteLabel"></span>
<input type="range" id="sprite" min="0" max="1023" step="1" value="0"></label>
<label>Mostrar foreground 8×8 (memoria completa)
<input type="checkbox" id="fg"></label>
<label>Voltear tile BG horizontalmente
<input type="checkbox" id="flip"></label>
</div>
<div class="actions"><button id="apply">Aplicar cambios de memoria</button>
<button id="reset" class="secondary">Igualar DESPUÉS a ANTES</button>
<span id="notice" class="desc">Desplazamiento y modificación pendientes de aplicar</span></div>
</section>
<div class="grid" style="margin-top:16px">
<section class="card"><h2>Direcciones alteradas</h2>
<div class="metric"><span id="count" class="num">0 bytes</span>
<span id="scrollInfo" class="desc">scroll 0x3b08..0x3b0b</span></div>
<table><thead><tr><th>Dirección</th><th>Origen</th><th>ANTES</th><th>DESPUÉS</th></tr></thead>
<tbody id="diff"></tbody></table>
<p class="desc">El scroll no es RAM normal; la comparación incluye el estado MMIO del adaptador de vídeo por separado.</p>
</section>
<section class="card"><h2>Qué representa este avance</h2>
<p class="desc"><strong>V1.1:</strong> sprites únicamente sobre cuadrícula. <strong>V1.2:</strong> imagen compuesta desde bytes de tilemap BG, registros de scroll, buffer de sprites y capa FG opcional; con orden BG detrás → sprites → BG prioridad delante → FG. Tiles y sprites son auténticos; disposición de la escena no.</p>
<p class="desc"><strong>Siguiente V1.3:</strong> alimentar esta misma vista con la inicialización de sprite RAM producida por el JavaScript generado desde la ROM. Hasta eso, ni la imagen ni el movimiento son generados por la lógica original.</p>
</section></div>
<footer>Referencia de direcciones y formatos: <a style="color:#8fe5d5" href="https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp">MAME gng.cpp</a>. Las ROM verificadas se incrustan en este HTML local. Guarda los PNG en <code>out/visual-evidence/v1.2/</code> y nunca publiques este HTML si contiene datos de tu ROM.</footer>
</main><script>
"use strict";
__VIDEO_MODULE__
__SPRITE_MODULE__
const encoded=__ROM_JSON__;
const images={};
for(const [k,v] of Object.entries(encoded)){
 const data=atob(v),bytes=new Uint8Array(data.length);
 for(let i=0;i<data.length;i++)bytes[i]=data.charCodeAt(i);
 images[k]=bytes;
}
const sprites=images.sprites,tiles=images.tiles,chars=images.chars;
const BG_ART=__BG_SELECTED__;
const FG_ART=__FG_SELECTED__;
const SPRITE_ART=__SPRITE_SELECTED__;
const $=id=>document.getElementById(id);
const hex=(x,n=2)=>x.toString(16).toUpperCase().padStart(n,"0");
const C={width:256,height:240};
const envNames=[
  ["#141f34","#2d4865","#496f84","#8aabb4","#a9c4ab","#c2ad83","#d7d8cb","#e6eddf"],
  ["#171d37","#354a69","#627e8b","#a1a6bc","#c1baa9","#9d92ae","#d0d7dd","#ecf0ed"],
  ["#18233c","#3c5270","#5c7c77","#8ba98c","#c8bb84","#a3a6ae","#ced2b9","#f3efdf"],
  ["#202032","#53475c","#7d667e","#a9938d","#ceae8b","#98a0ae","#d5d2bd","#f2eade"],
  ["#0d2931","#3c5e67","#608790","#95b4a3","#c8bc8d","#a5aabc","#d1dacf","#fff7e5"],
  ["#162e2c","#456b56","#739470","#b2c18e","#dbbc78","#ba999c","#d0dcb8","#fbf1d7"],
  ["#24223f","#514c73","#7e7697","#b79aae","#e0b894","#aaa8ce","#d8daec","#faf2e8"],
  ["#242a38","#555e72","#7b8394","#b9bbc2","#cbb194","#c2a4bb","#dbd8ce","#ffffff"],
];
const playerColors=[
  ["#243043","#ebe8de","#93c4c3","#e0a157","#c75a63","#afaacb","#ab75b8","#6eaf85","#e9cc72","#67869e","#da9c9b","#735996","#b67d50","#c2c3ae","#dea05d","#faf4e1"],
  ["#1d2d41","#c8d9f0","#b8a6d5","#eabe8d","#e48b9d","#88afd1","#d1a0c2","#93c5c4","#e6d18f","#86a9c8","#dbb9cd","#907dac","#c9a36d","#c1cbdc","#e7b894","#ffffff"],
  ["#283126","#d5d6a1","#aebc8f","#f7d6a4","#d3947d","#9eba9a","#b8a7ac","#87b7a7","#e3d29b","#91a1a5","#d1c2ac","#798b74","#b4a17e","#c9cba6","#e0b989","#fff7dd"],
  ["#301f38","#dacbe1","#bea0d4","#ead0a6","#d6a0ac","#93a4d0","#bd9abc","#8dbaa9","#e4cb91","#a285bb","#d8babd","#876a94","#b98b77","#c6b5d6","#f1c5ad","#fff8e8"],
];
function unpack(rgb){
 return rgb.map(x=>x.map(h=>{
    let code=h.slice(1);
    return [parseInt(code.slice(0,2),16),parseInt(code.slice(2,4),16),parseInt(code.slice(4,6),16)];
 }));
}
const BG_COLOR=unpack(envNames),SPR_COLOR=unpack(playerColors);
const FG_COLOR=Array.from({length:16},(_,index)=>{
 const c=BG_COLOR[index%8];
 return [c[0],c[2],c[4],c[6]];
});
function pixel(img,x,y,color){
 if(x<0||y<0||x>=256||y>=240)return;
 const index=(y*256+x)*4;
 img.data[index]=color[0];
 img.data[index+1]=color[1];
 img.data[index+2]=color[2];
 img.data[index+3]=255;
}
function blank(ctx){
 const image=ctx.createImageData(C.width,C.height);
 for(let i=0;i<image.data.length;i+=4){
  image.data[i]=12;image.data[i+1]=17;image.data[i+2]=30;image.data[i+3]=255;
 }
 return image;
}
function writeFixtureTile(mem,kind,col,row,art,palette,flip=false,group=0){
 writeTile(mem,kind,col,row,art,palette,flip,false,group);
}
function makeFixture(){
 const mem=new Uint8Array(65536);
 // 128 "unused" sprite records offscreen, not interpreted as real play state.
 mem.fill(248,SPRITE_RAM_START,SPRITE_RAM_START+SPRITE_RAM_LENGTH);
 for(let col=0;col<32;col++)for(let row=0;row<32;row++){
  const band=row<9?0:row<15?1:row<22?2:3;
  const ix=(col*5+(row>>1)+band*3)%BG_ART.length;
  // A deterministic tile collage: real ROM art, invented layout.
  writeFixtureTile(mem,"bg",col,row,BG_ART[ix],band*2%8,(col+row)%11===0,
    band===2&&(col%3===0)?1:0);
 }
 // FG holds genuine source tile bytes; initially the layer is switched off
 // as a DIAGNOSTIC visibility control, not a claim of authentic blank tiles.
 for(let col=0;col<32;col++)for(let row=0;row<32;row++)
  writeFixtureTile(mem,"fg",col,row,FG_ART[(col+row)%FG_ART.length],(col+row)%16);
 for(let slot=0;slot<5;slot++){
  const art=SPRITE_ART[slot%SPRITE_ART.length];
  const attr=((art>>>8)&3)<<6 | ((slot%4)<<4);
  writeSprite(mem,slot,[art&255,attr,(62+slot*28)&255,(24+slot*46)&255]);
 }
 return mem;
}
const beforeMem=makeFixture();
const afterMem=beforeMem.slice();
const beforeBuffer=snapshotSprites(beforeMem);
let afterBuffer=snapshotSprites(afterMem);
let changedMMIO={scrollX:0,scrollY:0};
let appliedFG=false;
const initialArtifact=BG_ART[0];
$("tile").value=String(BG_ART[3]);
$("sprite").value=String(SPRITE_ART[1]);
function labels(){
 for(const [id,key] of [["sx","sxLabel"],["sy","syLabel"],
   ["tile","tileLabel"],["color","colorLabel"],
   ["spriteX","spriteXLabel"],["sprite","spriteLabel"]])
   $(key).textContent=$(id).value;
}
function spriteMemoryChange(){
 const graphic=Number($("sprite").value),x=Number($("spriteX").value);
 const attr=((graphic>>>8)&3)<<6 | 0x10;
 writeSprite(afterMem,0,[graphic&255,attr,76,x]);
}
function scrollRegState(x,y){
 if(!Number.isInteger(x)||x<0||x>511||
    !Number.isInteger(y)||y<0||y>511)throw RangeError("Bad scroll register value");
 return {scrollX:x,scrollY:y,
   bytes:[x&255,x>>>8,y&255,y>>>8]};
}
function renderFrame(mem,buffer,scroll,fgVisible,canvas){
 const ctx=canvas.getContext("2d",{alpha:false});
 const image=blank(ctx);
 for(let y=0;y<240;y++)for(let x=0;x<256;x++){
  const t=screenTile(mem,"bg",x,y,scroll.scrollX,scroll.scrollY);
  const pen=readTilePen("bg",tiles,t.graphic,t.x,t.y);
  if(bgPixelLayer(t.group,pen,"back"))
    pixel(image,x,y,BG_COLOR[t.palette][pen]);
 }
 for(const sprite of drawOrder(buffer)){
  const pal=SPR_COLOR[sprite.paletteGroup];
  for(let sy=0;sy<16;sy++)for(let sx=0;sx<16;sx++){
    const pen=readSpritePen(sprites,sprite.graphic,
      sprite.flipX?15-sx:sx,sprite.flipY?15-sy:sy);
    if(pen===15)continue;
    pixel(image,sprite.x+sx,sprite.y+sy,pal[pen]);
  }
 }
 for(let y=0;y<240;y++)for(let x=0;x<256;x++){
  const t=screenTile(mem,"bg",x,y,scroll.scrollX,scroll.scrollY);
  if(t.group===0)continue;
  const pen=readTilePen("bg",tiles,t.graphic,t.x,t.y);
  if(bgPixelLayer(t.group,pen,"front"))
    pixel(image,x,y,BG_COLOR[t.palette][pen]);
 }
 if(fgVisible)for(let y=0;y<240;y++)for(let x=0;x<256;x++){
  const t=screenTile(mem,"fg",x,y);
  const pen=readTilePen("fg",chars,t.graphic,t.x,t.y);
  if(pen!==3)pixel(image,x,y,FG_COLOR[t.palette][pen]);
 }
 ctx.putImageData(image,0,0);
}
function rows(){
 const originalScroll=scrollRegState(0,0);
 const currentScroll=scrollRegState(changedMMIO.scrollX,changedMMIO.scrollY);
 let diff=[...changedTileBytes(beforeMem,afterMem,"bg"),
           ...changedTileBytes(beforeMem,afterMem,"fg")];
 for(let i=0;i<SPRITE_RAM_LENGTH;i++){
  const base=SPRITE_RAM_START+i;
  if(beforeMem[base]!==afterMem[base])
    diff.push({addr:base,before:beforeMem[base],after:afterMem[base],
      field:"sprite"});
 }
 for(let i=0;i<4;i++){
  if(originalScroll.bytes[i]!==currentScroll.bytes[i])
    diff.push({addr:0x3b08+i,before:originalScroll.bytes[i],
      after:currentScroll.bytes[i],field:"MMIO scroll"});
 }
 diff.sort((a,b)=>a.addr-b.addr);
 $("count").textContent=diff.length+" bytes alterados";
 $("scrollInfo").textContent="X="+changedMMIO.scrollX+
    ", Y="+changedMMIO.scrollY+", FG="+(appliedFG?"visible":"oculto por diagnóstico");
 const target=$("diff");
 target.textContent="";
 for(const change of diff.slice(0,20)){
  const tr=document.createElement("tr");
  for(const value of ["0x"+hex(change.addr,4),change.field,
     hex(change.before),hex(change.after)]){
    const td=document.createElement("td");td.textContent=value;tr.appendChild(td);
  }
  target.appendChild(tr);
 }
 if(diff.length>20){
  const tr=document.createElement("tr"),td=document.createElement("td");
  td.colSpan=4;td.textContent="… "+(diff.length-20)+" diferencias adicionales";
  tr.appendChild(td);target.appendChild(tr);
 }
}
function draw(){
 renderFrame(beforeMem,beforeBuffer,scrollRegState(0,0),false,$("before"));
 renderFrame(afterMem,afterBuffer,scrollRegState(changedMMIO.scrollX,
   changedMMIO.scrollY),appliedFG,$("after"));
 rows();
}
function apply(){
 const backgroundTile=Number($("tile").value);
 const color=Number($("color").value);
 // The exact BG address is col-major, and the FG address is row-major.
 writeFixtureTile(afterMem,"bg",12,12,backgroundTile,color,$("flip").checked,1);
 // Controlled visible FG attribute change, not a 'restored' game tilemap.
 writeFixtureTile(afterMem,"fg",11,8,FG_ART[0],13,$("flip").checked);
 spriteMemoryChange();
 changedMMIO={scrollX:Number($("sx").value),scrollY:Number($("sy").value)};
 appliedFG=$("fg").checked;
 afterBuffer=snapshotSprites(afterMem); // explicit copied sprite RAM buffer
 $("notice").textContent="Aplicado: RAM BG/FG + RAM sprite → buffer + MMIO scroll";
 draw();
}
for(const id of ["sx","sy","tile","color","spriteX","sprite","fg","flip"]){
 $(id).addEventListener("input",()=>{
  labels();$("notice").textContent="Cambios pendientes: pulsa «Aplicar cambios»";
 });
}
$("apply").addEventListener("click",apply);
$("reset").addEventListener("click",()=>{
 afterMem.set(beforeMem);
 changedMMIO={scrollX:0,scrollY:0};
 appliedFG=false;afterBuffer=snapshotSprites(afterMem);
 $("sx").value="0";$("sy").value="0";$("tile").value=String(BG_ART[3]);
 $("color").value="3";$("spriteX").value="24";$("sprite").value=String(SPRITE_ART[0]);
 $("flip").checked=false;$("fg").checked=false;
 labels();$("notice").textContent="Estado B idéntico a A; 0 cambios RAM/MMIO";
 draw();
});
function save(canvas,label){
 const a=document.createElement("a");a.download="v1.2-"+label+".png";
 a.href=canvas.toDataURL("image/png");a.click();
}
$("saveBefore").addEventListener("click",()=>save($("before"),"before"));
$("saveAfter").addEventListener("click",()=>save($("after"),"after"));
labels();apply();
</script></body></html>
"""


def build(rom:Path,out:Path,shared:Path|None=None)->dict:
    archives=[rom]+([shared] if shared is not None and shared!=rom else [])
    regions,hashes=load_regions(archives)
    parent=Path(__file__).resolve().parent
    sources={
        "__VIDEO_MODULE__":(parent/"video_memory.mjs").read_text(encoding="utf-8"),
        "__SPRITE_MODULE__":(parent/"sprite_memory.mjs").read_text(encoding="utf-8"),
    }
    for key in sources:
        value=sources[key]
        if "import " in value or "export default" in value:
            raise ValueError("External imports forbidden in self-contained HTML")
        sources[key]=value.replace("export function ","function ").replace("export const ","const ")
    selected={
        "bg":choose_tiles(regions["tiles"],"bg"),
        "fg":choose_tiles(regions["chars"],"fg"),
        "sprites":pick_sprites(regions["sprites"],count=5),
    }
    # As in previous viewer, only private gfx ROMs are embedded, never pushed.
    payload={name:base64.b64encode(region).decode("ascii")
             for name,region in regions.items()}
    sources.update({
        "__ROM_JSON__":json.dumps(payload,separators=(",",":")),
        "__BG_SELECTED__":json.dumps(selected["bg"]),
        "__FG_SELECTED__":json.dumps(selected["fg"]),
        "__SPRITE_SELECTED__":json.dumps(selected["sprites"]),
    })
    rendered=HTML
    for key,value in sources.items():
        if rendered.count(key)!=1:
            raise ValueError("Missing/ambiguous HTML marker "+key)
        rendered=rendered.replace(key,value)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(rendered,encoding="utf-8")
    report={
        "schema":SCHEMA,
        "status":"VRAM_FIXTURE_NOT_GAME_FRAME",
        "viewer":str(out),
        "sha256":hashlib.sha256(rendered.encode()).hexdigest(),
        "gngb_rom_part_sha256":hashes,
        "selected_rom_graphic_indices":selected,
        "layers":["BG_BACK","SPRITES","BG_FRONT","FG_OPTIONAL"],
        "source_bytes_from_game_rom":True,
        "memory_fixture_generated_by_game":False,
        "gameplay":False,
        "game_frame":False,
        "real_hardware_palette":False,
        "video_mmio_scroll_injected":True,
        "source_6809_executed":False,
        "references":["src/mame/capcom/gng.cpp charlayout","tilelayout",
                      "spritelayout","get_fg_tile_info","get_bg_tile_info",
                      "screen_update","bgscrollx_w","bgscrolly_w"],
    }
    (out.parent/"vram-scene.report.json").write_text(
        json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    return report


def main()->None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom",type=Path,default=Path("roms/gng.zip"))
    parser.add_argument("--shared",type=Path)
    parser.add_argument("--out",type=Path,default=Path("out/visual/vram-scene.html"))
    args=parser.parse_args()
    try:
        result=build(args.rom,args.out,args.shared)
    except (ValueError,OSError) as exc:
        parser.error(str(exc))
    print("GNG_VISUAL_V1_2=GENERATED layers=4 tilemaps=RAM "
          "scroll=EXPLICIT palette=INSPECTION")
    print("GNG_VISUAL_V1_2_HTML="+result["viewer"])
    print("GNG_TRANSLATED_GAME_FRAME=NOT_ESTABLISHED stage_layout=FIXTURE")

if __name__=="__main__":
    main()
