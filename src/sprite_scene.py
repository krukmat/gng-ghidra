#!/usr/bin/env python3
"""V1.1: genuine GNG sprite ROM pixels drawn from a 64-KiB RAM fixture.

Creates one self-contained offline HTML, two side-by-side 256x240 Canvases
and exact before/after sprite RAM byte deltas. This is NOT a game frame:
the RAM is constructed for a visual test, not produced by original CPU code.
Sprite display uses a separate explicit DMA snapshot (0x3c00 equivalent),
the source bytes are checked against MAME gngb CRCs, no ROM is uploaded.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path

from graphics_preview import load_regions

SCHEMA="gng.visible-sprite-ram.v1"
SPRITE_SIZE=0x20000
BYTES_PER_SPRITE=64
SPRITES=1024

def pen(rom:bytes, index:int, x:int, y:int)->int:
    """MAME spritelayout: four 4-bit planes, including erased bank gap."""
    half=0x10000*8
    planes=[half+4,half,4,0]
    x_offsets=[0,1,2,3,8,9,10,11,
               256,257,258,259,264,265,266,267]
    pixel_base=index*512+x_offsets[x]+y*16
    value=0
    for bit,plane in enumerate(planes):
        location=pixel_base+plane
        value|=((rom[location//8]>>(7-(location%8)))&1)<<bit
    return value

def pick_sprites(rom:bytes,count:int=3)->list[int]:
    if len(rom)!=SPRITE_SIZE:
        raise ValueError("Expected the original 0x20000-byte sprite graphics region")
    # Avoid selecting empty/solid sprites in the proof's initial fixture.
    # Do not call these "Arthur" or assert what game scene uses them.
    found=[]
    for index in range(SPRITES):
        colors={0:0}
        visible=0
        for y in range(16):
            for x in range(16):
                p=pen(rom,index,x,y)
                colors[p]=colors.get(p,0)+1
                if p!=15:
                    visible+=1
        if 48<=visible<=240 and len(colors)>=4 and \
                (not found or index-found[-1]>=8):
            found.append(index)
            if len(found)>=count:
                return found
    # This is still ROM-derived; no substitute graphics are invented.
    if found:
        while len(found)<count: found.append(found[0])
        return found
    return list(range(count))

HTML=r"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GnG V1.1 — Sprite RAM before / after</title>
<style>
:root{color-scheme:dark;background:#0b101e;color:#edf2fa;font-family:system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top left,#202a45,#0b101e 65%)}
main{max-width:1320px;margin:0 auto;padding:24px 18px 50px}
h1{font-size:clamp(22px,3.5vw,36px);margin:6px 0 8px;letter-spacing:-.035em}
p{line-height:1.5}.subtitle{color:#b5c4dc;max-width:990px}
.eyebrow{font-size:11px;color:#8fe0d3;letter-spacing:.13em;font-weight:750}
.notice{padding:12px 15px;background:#1c2941;border:1px solid #546888;border-radius:9px;color:#f1e4bc;font-size:13px;margin:16px 0}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.card{background:#121d31;border:1px solid #374965;border-radius:13px;padding:15px;min-width:0}
.head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.tag{font:700 11px ui-monospace,monospace;color:#8de3d2;letter-spacing:.08em}
h2{font-size:17px;margin:3px 0 10px}
canvas{width:100%;max-width:520px;aspect-ratio:256/240;image-rendering:pixelated;display:block;margin:0 auto;background:#080e1a;border:1px solid #35435a;border-radius:4px}
button{padding:9px 13px;cursor:pointer;border-radius:7px;color:#e9f8f6;background:#224a57;border:1px solid #448b92;font:600 13px system-ui}
button:hover{background:#35626c}
.weak{background:#273550;border-color:#556882}
.controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:13px;align-items:end}
label{color:#c4d1e6;font-size:12px;font-weight:600;display:grid;gap:5px}
input[type=range]{width:100%;accent-color:#76dbc9}
input[type=checkbox]{accent-color:#76dbc9;justify-self:start}
small{font-size:12px;color:#a8b9d2}
.metric{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
code{font:12px ui-monospace,monospace;color:#f7dfaa}
table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #293a53}
th{color:#abc5e6;font:700 11px system-ui}
.numeral{color:#95edd9;font-weight:700}
.details{color:#9ab0cc;font-size:13px}
footer{color:#97aac7;font-size:12px;margin-top:20px;line-height:1.55}
@media(max-width:780px){.grid{grid-template-columns:1fr}}
</style></head>
<body><main><div class="eyebrow">V1.1 · MEMORIA DE SPRITES → PIXELES ROM</div>
<h1>Ghosts 'n Goblins — ¿cambia la imagen cuando cambia la RAM?</h1>
<p class="subtitle">Los sprites son imágenes reales de la ROM <strong>gngb</strong>. Sus posiciones, índices y atributos vienen de registros de 4 bytes en <code>0x1e00..0x1fff</code>. Prueba visual reproducible con dos estados RAM: se modifican bytes, se copia la RAM al buffer y se vuelve a pintar.</p>
<div class="notice">⚠️ <strong>VRAM FIXTURE — NO GAMEPLAY.</strong> Ni el estado ANTES ni DESPUÉS procede de una partida, ni se está ejecutando la CPU Motorola 6809. Los colores y la cuadrícula son ayudas de inspección, no la paleta RGB real de la placa.</div>
<div class="grid">
<section class="card"><div class="head"><div><div class="tag">ESTADO A · BUFFER ORIGINAL</div><h2>ANTES</h2></div><button class="weak" id="saveBefore">Guardar ANTES PNG</button></div>
<canvas id="before" width="256" height="240" aria-label="Estado inicial de sprite RAM"></canvas>
<p class="details">Snapshot de RAM 0x1e00–0x1fff. Este lienzo se mantiene fijo.</p></section>
<section class="card"><div class="head"><div><div class="tag">ESTADO B · BUFFER COPIADO</div><h2>DESPUÉS</h2></div><button class="weak" id="saveAfter">Guardar DESPUÉS PNG</button></div>
<canvas id="after" width="256" height="240" aria-label="Estado modificado de sprite RAM"></canvas>
<p class="details" id="dmaInfo">Modificación del registro + copia explícita de RAM al buffer.</p></section>
</div>
<section class="card" style="margin-top:14px"><div class="head"><h2>Modificar un registro real de sprite RAM</h2><span class="tag">SLOT 0 · 0x1E00..0x1E03</span></div>
<div class="controls">
<label>Posición X <span class="numeral" id="xNum"></span><input id="x" type="range" min="-16" max="240" value="144"></label>
<label>Posición Y <span class="numeral" id="yNum"></span><input id="y" type="range" min="0" max="224" value="105"></label>
<label>Sprite ROM index <span class="numeral" id="artNum"></span><input id="art" type="range" min="0" max="1023" value="0"></label>
<label>Palette group (índice, colores de inspección) <span class="numeral" id="colorNum"></span><input id="color" type="range" min="0" max="3" value="1"></label>
<label>Voltear X <input id="flipX" type="checkbox"></label>
<label>Voltear Y <input id="flipY" type="checkbox"></label>
</div>
<div class="metric" style="margin-top:16px">
<button id="apply">Aplicar cambios · copiar RAM → buffer</button>
<button id="reset" class="weak">Reiniciar estado B</button>
<span class="details" id="status" role="status">Estado B cargado desde fixture original + dos bytes de RAM modificados.</span>
</div></section>
<section class="card" style="margin-top:14px"><h2>Prueba byte a byte</h2>
<p class="details">Las diferencias siguientes son bytes reales del array RAM de prueba; el renderer consume una <strong>copia</strong> del buffer, como la transferencia de sprites de la placa. No son datos de una partida.</p>
<div class="metric"><strong id="delta" class="numeral">0 bytes</strong><small id="counts"></small></div>
<table><thead><tr><th>Dirección CPU</th><th>Byte</th><th>ANTES</th><th>DESPUÉS</th></tr></thead>
<tbody id="changes"></tbody></table></section>
<footer>V1.1 · Diseño de registros, orden de dibujo y bitplanes conforme a <a style="color:#82e0cf" href="https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp">MAME Capcom gng.cpp</a>. El HTML incrusta solo los bitplanes de tu ROM privada y se genera en <code>out/</code>. No lo subas a GitHub. Próximo hito: V1.2 con capas FG/BG y scroll; V2 será el primer frame generado por código del juego traducido.</footer>
</main><script>
"use strict";
__SPRITE_MODULE__
const imageBytes=atob(__SPRITE_B64__);
const spriteROM=new Uint8Array(imageBytes.length);
for(let i=0;i<imageBytes.length;i++)spriteROM[i]=imageBytes.charCodeAt(i);
const assetIds=__INITIAL_ASSETS__;
const $=name=>document.getElementById(name);
const toHex=(v,width=2)=>v.toString(16).toUpperCase().padStart(width,"0");
const originalRAM=new Uint8Array(65536).fill(0);
// Blank offscreen fixture: not the game's real memory/ROM boot state.
// Every unused record stays y=248 (fully below visible 240 lines).
originalRAM.fill(0xf8,SPRITE_RAM_START,SPRITE_RAM_START+SPRITE_RAM_LENGTH);
function record(memory,slot,code,x,y,palette,flipX=false,flipY=false){
  const attr=((code>>>8)&3)<<6 | ((palette&3)<<4) |
    (flipX?4:0) | (flipY?8:0) | (x<0?1:0);
  writeSprite(memory,slot,[code&255,attr,y,x&255]);
}
record(originalRAM,0,assetIds[0],52,75,0);
record(originalRAM,1,assetIds[1],92,130,2);
record(originalRAM,2,assetIds[2],166,52,3);
const initialBefore=snapshotSprites(originalRAM);
const modifiedRAM=originalRAM.slice();
const initCode=assetIds[1];
$("art").value=String(initCode);
let afterBuffer;
function commitFromControls(){
  const art=Number($("art").value),x=Number($("x").value),y=Number($("y").value);
  record(modifiedRAM,0,art,x,y,Number($("color").value),
    $("flipX").checked,$("flipY").checked);
}
function labels(){
  for(const name of ["x","y","art","color"])
    $(name+"Num").textContent=$(name).value;
}
function background(ctx){
  ctx.fillStyle="#0c1627";ctx.fillRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);
  ctx.strokeStyle="#1b3149";ctx.lineWidth=1;
  for(let x=0;x<=SCREEN_WIDTH;x+=16){
    ctx.beginPath();ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,SCREEN_HEIGHT);ctx.stroke();
  }
  for(let y=0;y<=SCREEN_HEIGHT;y+=16){
    ctx.beginPath();ctx.moveTo(0,y+.5);ctx.lineTo(SCREEN_WIDTH,y+.5);ctx.stroke();
  }
}
const groups=[
 ["#132439","#f5dcb7","#9dcaba","#ef9d57","#d36b72","#98a9d3","#b17fc7","#6dab91","#f3cf79","#5d849d","#e3a5a8","#795c97","#bb783e","#bec2ad","#de9253","#fff7db"],
 ["#1b2448","#a5cfff","#b6a4f2","#f9dca9","#f294a3","#82b1db","#ba79b4","#76c1b5","#fee19b","#7595c2","#dbbbd4","#a89bbb","#bd9863","#dad6bd","#edb191","#fff8e4"],
 ["#182b1d","#b7dc8a","#d7c386","#e9a86a","#c77f83","#84af8a","#a28bbc","#f0d39e","#f5e6bf","#537f6e","#d5afb6","#a3b59c","#e3bb92","#9fc6b0","#e7d69b","#fff4d2"],
 ["#322035","#d6acd5","#a4bfdc","#eac194","#ec8e8c","#ce9dbd","#8394c7","#caa9a1","#fae1b8","#936cb4","#9aaba9","#d7b79e","#bd8a76","#c9accd","#edbeb6","#fff4e4"]
];
function paint(buffer,canvas){
  const ctx=canvas.getContext("2d",{alpha:false});
  ctx.imageSmoothingEnabled=false;
  background(ctx);
  // MAME gng.cpp: scan the 128 sprite records from high to low offsets.
  for(const sprite of drawOrder(buffer)){
    const colors=groups[sprite.paletteGroup];
    for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const pen=readSpritePen(spriteROM,sprite.graphic,
        sprite.flipX?15-x:x,sprite.flipY?15-y:y);
      if(pen===15)continue; // original transparency index
      const sx=sprite.x+x,sy=sprite.y+y;
      if(sx<0||sy<0||sx>=SCREEN_WIDTH||sy>=SCREEN_HEIGHT)continue;
      ctx.fillStyle=colors[pen];
      ctx.fillRect(sx,sy,1,1);
    }
  }
  ctx.font="8px ui-monospace,monospace";
  ctx.fillStyle="#d0dfef";
  ctx.fillText("RAM FIXTURE / NO GAME FRAME",5,SCREEN_HEIGHT-7);
}
function showDiff(){
  const diff=changedSpriteBytes(initialBefore,afterBuffer);
  $("delta").textContent=diff.length+" bytes modificados";
  $("counts").textContent="ANTES: "+drawOrder(initialBefore).length+
    " sprites visibles · DESPUÉS: "+drawOrder(afterBuffer).length+" sprites visibles";
  const rows=$("changes");
  rows.textContent="";
  for(const d of diff.slice(0,16)){
    const tr=document.createElement("tr");
    for(const val of ["0x"+toHex(d.addr,4),["Código","Atributos","Y","X"][d.field],
      toHex(d.before),toHex(d.after)]){
      const td=document.createElement("td");
      td.textContent=val;tr.appendChild(td);
    }
    rows.appendChild(tr);
  }
  if(diff.length>16){
    const tr=document.createElement("tr"),td=document.createElement("td");
    td.colSpan=4;td.textContent="… y "+(diff.length-16)+" bytes más";
    tr.appendChild(td);rows.appendChild(tr);
  }
}
function render(){
  paint(initialBefore,$("before"));
  paint(afterBuffer,$("after"));
  showDiff();
}
function apply(){
  commitFromControls();
  afterBuffer=snapshotSprites(modifiedRAM); // explicit buffer/DMA event
  $("status").textContent="RAM copiada al buffer: cambio visible en estado B";
  render();
}
for(const name of ["x","y","art","color","flipX","flipY"]){
  $(name).addEventListener("input",()=>{
    labels();
    $("status").textContent="Edición pendiente: pulsa «Aplicar cambios» para actualizar el buffer";
  });
}
$("apply").addEventListener("click",apply);
$("reset").addEventListener("click",()=>{
  modifiedRAM.set(originalRAM);
  $("x").value="52";$("y").value="75";$("art").value=String(assetIds[0]);
  $("color").value="0";$("flipX").checked=false;$("flipY").checked=false;
  labels();
  afterBuffer=snapshotSprites(modifiedRAM);
  $("status").textContent="Estado B reiniciado, 0 diferencias";
  render();
});
function saveCanvas(canvas,name){
  const a=document.createElement("a");
  a.download=name;a.href=canvas.toDataURL("image/png");
  a.click();
}
$("saveBefore").addEventListener("click",()=>saveCanvas($("before"),"v1.1-before.png"));
$("saveAfter").addEventListener("click",()=>saveCanvas($("after"),"v1.1-after.png"));
labels();apply();
</script></body></html>
"""

def build(rom_path:Path, out:Path, shared_path:Path|None=None)->dict:
    paths=[rom_path]
    if shared_path is not None and shared_path!=rom_path:
        paths.append(shared_path)
    regions,hashes=load_regions(paths)
    sprite=regions["sprites"]
    if len(sprite)!=SPRITE_SIZE:
        raise ValueError("Sprite ROM region not in expected MAME layout")
    selected=pick_sprites(sprite)
    source=Path(__file__).resolve().parent/"sprite_memory.mjs"
    logic=source.read_text(encoding="utf-8")
    if "import " in logic or "export default" in logic:
        raise ValueError("Embedded sprite memory helper has unsupported dependencies")
    logic=logic.replace("export const ","const ").replace("export function ","function ")
    rendered=HTML.replace("__SPRITE_MODULE__",logic)
    rendered=rendered.replace("__SPRITE_B64__",json.dumps(
        base64.b64encode(sprite).decode("ascii")))
    rendered=rendered.replace("__INITIAL_ASSETS__",json.dumps(selected))
    if any(s in rendered for s in ["__SPRITE_MODULE__","__SPRITE_B64__",
                                     "__INITIAL_ASSETS__"]):
        raise RuntimeError("Unresolved offline viewer template marker")
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(rendered,encoding="utf-8")
    report={
        "schema":SCHEMA,
        "status":"VRAM_FIXTURE_NOT_REAL_GAME_FRAME",
        "file":str(out),
        "sha256":hashlib.sha256(rendered.encode()).hexdigest(),
        "original_rom_sprite_sha256":hashlib.sha256(sprite).hexdigest(),
        "rom_source_part_sha256":{key:value for key,value in hashes.items()
                                  if key.startswith("gg") and key!="gg1.bin"},
        "initial_sprite_rom_indices":selected,
        "sprite_ram_range":["0x1e00","0x2000"],
        "cpu_original_logic_executed":False,
        "cpu_emulated":False,
        "gameplay":False,
        "sprite_dma_snapshot_explicit":True,
        "palette":"inspection-only, not actual RGBx444",
        "checks":["original sprite bitplanes","4-byte RAM records",
                  "MAME hardware draw order","before/after RAM byte differences"],
    }
    (out.parent/"vram-sprites.report.json").write_text(
        json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    return report

def main()->None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom",type=Path,default=Path("roms/gng.zip"))
    parser.add_argument("--shared",type=Path,default=None)
    parser.add_argument("--out",type=Path,default=Path("out/visual/vram-sprites.html"))
    args=parser.parse_args()
    try:
        report=build(args.rom,args.out,args.shared)
    except (ValueError,OSError) as exc:
        parser.error(str(exc))
    print("GNG_VISUAL_V1_1=GENERATED scene=RAM_FIXTURE "
          "buffer=explicit sprites=3 artwork=ROM")
    print("GNG_VISUAL_V1_1_HTML="+report["file"])
    print("GNG_GAME_FRAME=NOT_ESTABLISHED needs CPU-generated video state")

if __name__=="__main__":
    main()
