#!/usr/bin/env python3
"""Compare a REAL MAME frame to ROM-derived JS renderer using SAME captured VRAM.

No arbitrary tile collage, no invented stage, no Motorola 6809 interpreter.
MAME is an external test oracle ONLY. JS draws from captured actual game
FG/BG/sprite-buffer bytes with original graphics ROM and captured RGB palette.
All graphics and screenshots remain in ignored out/ on the operator's Mac.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path

from graphics_preview import load_regions

SCHEMA="gng.real-frame-js-replay.v1"
FILES={
    "foreground":("foreground.bin",0x800),
    "background":("background.bin",0x800),
    "sprites":("sprites-buffered.bin",0x200),
    "palette":("palette-rgba.bin",0x400),
}

def read_reference(reference_dir:Path)->tuple[dict,dict[str,bytes]]:
    manifest=json.loads((reference_dir/"manifest.json").read_text())
    if manifest.get("schema")!="gng.mame-video-capture.v1":
        raise ValueError("Unknown independent MAME frame manifest")
    if manifest.get("status")!="NATIVE_REFERENCE_CAPTURED_NOT_JS_EQUIVALENCE":
        raise ValueError("Not an independently captured MAME frame")
    if manifest.get("sprite_dma_observed") is not True:
        raise ValueError("No independently captured DMA sprite buffer")
    if manifest.get("generated_js_frame_equivalent") is not False:
        raise ValueError("Cannot infer or override JS equivalence flag")
    assert manifest.get("system") in ("gng","gngb"),"Unsupported MAME system"
    for key in ("scroll_x","scroll_y"):
        x=manifest.get(key)
        if type(x) is not int or x<0 or x>65535:
            raise ValueError("Missing/untrusted MAME scroll: "+key)
    data={}
    all_files={**FILES,"reference":("reference.png",None)}
    for name,(filename,expected_length) in all_files.items():
        metadata=manifest.get("artifacts",{}).get(name,{})
        if metadata.get("filename")!=filename:
            raise ValueError("MAME artifact filename mismatch: "+name)
        payload=(reference_dir/filename).read_bytes()
        if expected_length is not None and len(payload)!=expected_length:
            raise ValueError("MAME artifact unexpected size: "+name)
        if hashlib.sha256(payload).hexdigest()!=metadata.get("sha256"):
            raise ValueError("MAME evidence digest mismatch: "+name)
        data[name]=payload
    if (manifest["artifacts"]["reference"].get("width")!=256 or
            manifest["artifacts"]["reference"].get("height")!=224):
        raise ValueError("Expected 256x224 reference image")
    return manifest,data


HTML=r"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GnG — frame REAL contra renderer JS</title>
<style>
:root{color-scheme:dark;background:#0c1322;color:#e9f3fe;font-family:system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 25% 0,#22354d,#0c1322 56%)}
main{max-width:1250px;margin:0 auto;padding:30px 18px 60px}
h1{font-size:clamp(25px,4vw,39px);letter-spacing:-.035em;margin:7px 0}
.kicker{color:#83e1d1;font:700 11px ui-monospace,monospace;letter-spacing:.14em}
p{line-height:1.55;color:#bccde3}
.warning{background:#2c2c40;border:1px solid #6b627f;padding:12px;border-radius:8px;color:#f3e5d6;font-size:13px}
.panes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:22px}
.panel{background:#131f33;border:1px solid #344b68;border-radius:13px;padding:18px}
h2{font-size:18px;margin:6px 0 5px}
img,canvas{display:block;image-rendering:pixelated;image-rendering:crisp-edges;width:100%;max-width:512px;aspect-ratio:256/224;margin:16px auto;background:#060a12}
.meta{font:12px ui-monospace,monospace;color:#a8bed9;line-height:1.7}
button{border:1px solid #66b6a5;background:#22464b;color:#f0f6ff;font:600 13px system-ui;padding:10px 14px;border-radius:7px;cursor:pointer}
.metrics{margin:22px 0;padding:18px;background:#112337;border:1px solid #2e5062;border-radius:13px}
.number{color:#95edda;font:700 22px ui-monospace,monospace}
.note{font-size:13px;color:#bdcee4}
code{color:#e5daa7}
footer{font-size:12px;color:#8da5c4;margin-top:22px;line-height:1.55}
@media(max-width:750px){.panes{grid-template-columns:1fr}}
</style></head>
<body><main>
<div class="kicker">V2 REFERENCE GATE · REAL ARCADE VIDEO STATE</div>
<h1>El fotograma real frente al JavaScript</h1>
<p>La imagen izquierda fue producida por <strong>MAME ejecutando el juego original</strong> únicamente para obtener una referencia. La derecha se genera con <strong>nuestro renderer JavaScript</strong> a partir de la RAM, el scroll, el buffer de sprites y los colores capturados del mismo estado. No hay emulación MC6809 dentro del renderer JS.</p>
<div class="warning">Esta prueba no certifica automáticamente la equivalencia de frames. Si hay discrepancias, deben corregirse contra la referencia. El renderer no está ejecutando aún la lógica del juego traducida: reproduce memoria capturada de una ejecución de referencia. No publicar el HTML ni la captura, porque derivan de tu ROM.</div>
<div class="panes">
<section class="panel"><div class="kicker">ORÁCULO EXTERNO</div><h2>Fotograma original</h2>
<img id="reference" width="256" height="224" src="data:image/png;base64,__REFERENCE_B64__" alt="Fotograma MAME auténtico">
<div class="meta">Capturado de MAME · screenshot PNG nativo</div></section>
<section class="panel"><div class="kicker">REPRODUCCIÓN SIN CPU</div><h2>Renderer JavaScript</h2>
<canvas id="js" width="256" height="224" aria-label="Fotograma generado desde memoria ROM original"></canvas>
<div class="meta">Ghidra compatible / VRAM original · Canvas 256×224</div>
<button id="save">Guardar resultado JS PNG</button></section>
</div>
<section class="metrics"><div class="kicker">COMPARACIÓN OBJETIVA</div>
<div class="number" id="compare">Pendiente de calcular</div>
<p class="note" id="details">Se compara cada pixel RGBA cuando la imagen PNG esté cargada. Las diferencias de tiempo del snapshot DMA/paleta se consideran errores pendientes, no éxitos.</p>
<canvas id="difference" width="256" height="224" aria-label="Mapa de diferencia de píxeles"></canvas>
<div class="meta" id="state">Estado: sin procesar</div>
</section>
<footer>Datos: FG CPU 0x2000..0x27ff, BG CPU 0x2800..0x2fff, buffer de sprites desde DMA 0x3c00, MMIO scroll 0x3b08..0x3b0b, paleta RGBx_444 interpretada por MAME. Gráficos originales gngb verificados por CRC. La imagen izquierda sirve solo como oráculo de prueba; la aplicación final NO utilizará un emulador.</footer>
</main><script>
"use strict";
__VIDEO_MODULE__
__SPRITE_MODULE__
const encoded=__ROM_AND_RAM__;
const arrays={};
for(const [key,text] of Object.entries(encoded)){
 const ascii=atob(text),bytes=new Uint8Array(ascii.length);
 for(let i=0;i<ascii.length;i++)bytes[i]=ascii.charCodeAt(i);
 arrays[key]=bytes;
}
const originalRAM=new Uint8Array(65536);
originalRAM.set(arrays.foreground,0x2000);
originalRAM.set(arrays.background,0x2800);
const spriteBuffer=arrays.spriteBuffer;
const colors=arrays.palette;
const scroll=__SCROLL__;
const CAPTURE_FRAME=__FRAME__;
const W=256,H=224,VERTICAL_START=16;
function pal(index){
 const i=index*4;
 return [colors[i],colors[i+1],colors[i+2]];
}
function paint(image,x,y,paletteIndex){
 if(x<0||y<0||x>=W||y>=H)return;
 const pixel=(y*W+x)*4,p=paletteIndex*4;
 image.data[pixel]=colors[p];
 image.data[pixel+1]=colors[p+1];
 image.data[pixel+2]=colors[p+2];
 image.data[pixel+3]=255;
}
function drawCaptured(){
 const canvas=document.getElementById("js"),ctx=canvas.getContext("2d",{alpha:false});
 const image=ctx.createImageData(W,H);
 // All remaining pixels will be replaced by BG back layer when opaque.
 // For group1, MAME transmask leaves pen0 and pen6 to BG back,
 // others are assigned to the front pass.
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const hardwareY=y+VERTICAL_START;
  const t=screenTile(originalRAM,"bg",x,hardwareY,scroll.x,scroll.y);
  const pen=readTilePen("bg",arrays.tiles,t.graphic,t.x,t.y);
  if(bgPixelLayer(t.group,pen,"back"))
   paint(image,x,y,t.palette*8+pen);
 }
 // Buffered sprite RAM captured by independent MAME DMA write tap.
 for(const sprite of drawOrder(spriteBuffer)){
  for(let sy=0;sy<16;sy++)for(let sx=0;sx<16;sx++){
   const pen=readSpritePen(arrays.sprites,sprite.graphic,
     sprite.flipX?15-sx:sx,sprite.flipY?15-sy:sy);
   if(pen===15)continue;
   paint(image,sprite.x+sx,sprite.y+sy-VERTICAL_START,
     0x40+sprite.paletteGroup*16+pen);
  }
 }
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const hardwareY=y+VERTICAL_START;
  const t=screenTile(originalRAM,"bg",x,hardwareY,scroll.x,scroll.y);
  if(t.group===0)continue;
  const pen=readTilePen("bg",arrays.tiles,t.graphic,t.x,t.y);
  if(bgPixelLayer(t.group,pen,"front"))
   paint(image,x,y,t.palette*8+pen);
 }
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const t=screenTile(originalRAM,"fg",x,y+VERTICAL_START);
  const pen=readTilePen("fg",arrays.chars,t.graphic,t.x,t.y);
  if(pen!==3)paint(image,x,y,0x80+t.palette*4+pen);
 }
 ctx.putImageData(image,0,0);
 return image;
}
const jsFrame=drawCaptured();
document.getElementById("state").textContent=
 "Frame de referencia "+CAPTURE_FRAME+
 " · scroll X="+scroll.x+", Y="+scroll.y+
 " · BG/FG/sprites capturados; motores independientes";
const reference=document.getElementById("reference");
function compare(){
 try {
  const refCanvas=document.createElement("canvas");
  refCanvas.width=W;refCanvas.height=H;
  const ctx=refCanvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(reference,0,0);
  const pixels=ctx.getImageData(0,0,W,H).data;
  const diffCanvas=document.getElementById("difference"),
        diffCtx=diffCanvas.getContext("2d");
  const overlay=diffCtx.createImageData(W,H);
  let wrong=0,sum=0;
  for(let i=0;i<pixels.length;i+=4){
   const delta=Math.max(
    Math.abs(pixels[i]-jsFrame.data[i]),
    Math.abs(pixels[i+1]-jsFrame.data[i+1]),
    Math.abs(pixels[i+2]-jsFrame.data[i+2]));
   if(delta>0)wrong++;
   sum+=delta;
   overlay.data[i]=delta?255:17;
   overlay.data[i+1]=delta?45:49;
   overlay.data[i+2]=delta?63:66;
   overlay.data[i+3]=255;
  }
  diffCtx.putImageData(overlay,0,0);
  const percent=(wrong/(W*H)*100).toFixed(2);
  document.getElementById("compare").textContent=
   wrong+" / "+(W*H)+" píxeles diferentes ("+percent+"%)";
  document.getElementById("details").textContent=
   (wrong===0?"Comparación pixel-perfect en este fotograma capturado. ":
    "Mapa rojo = píxeles que no coinciden; hay que investigar el hardware. ")+
   "Error máximo promedio: "+(sum/(W*H)).toFixed(2)+"/255. "+
   "Esto no demuestra ejecución de lógica de juego traducida.";
 }catch(error){
  document.getElementById("compare").textContent="Comparación bloqueada";
  document.getElementById("details").textContent=String(error.message);
 }
}
reference.addEventListener("load",compare);
reference.addEventListener("error",()=>{
 document.getElementById("compare").textContent="ERROR: imagen MAME no cargada";
});
if(reference.complete&&reference.naturalWidth>0)compare();
document.getElementById("save").addEventListener("click",()=>{
 const a=document.createElement("a");
 a.download="gng-native-ram-js-frame.png";
 a.href=document.getElementById("js").toDataURL("image/png");
 a.click();
});
</script></body></html>
"""


def build(graphics_zip:Path,reference_dir:Path,out:Path,
          shared:Path|None=None)->dict:
    state,artifacts=read_reference(reference_dir)
    paths=[graphics_zip]+([shared] if shared is not None and shared!=graphics_zip else [])
    regions,part_hashes=load_regions(paths)
    if len(regions["sprites"])!=0x20000 or len(regions["tiles"])!=0x18000:
        raise ValueError("Graphics ROM regions have unexpected lengths")
    parent=Path(__file__).resolve().parent
    modules={
        "__VIDEO_MODULE__":parent.joinpath("video_memory.mjs").read_text(),
        "__SPRITE_MODULE__":parent.joinpath("sprite_memory.mjs").read_text(),
    }
    for name,content in modules.items():
        if "import " in content or "export default" in content:
            raise ValueError("Standalone renderer module has external dependency")
        modules[name]=(content.replace("export const ","const ")
                              .replace("export function ","function "))
    payload={
        "foreground":artifacts["foreground"],
        "background":artifacts["background"],
        "spriteBuffer":artifacts["sprites"],
        "palette":artifacts["palette"],
        "chars":regions["chars"],
        "tiles":regions["tiles"],
        "sprites":regions["sprites"],
    }
    substitutions={
        **modules,
        "__ROM_AND_RAM__":json.dumps({
            k:base64.b64encode(v).decode("ascii") for k,v in payload.items()
        },separators=(",",":")),
        "__SCROLL__":json.dumps({"x":state["scroll_x"],"y":state["scroll_y"]}),
        "__FRAME__":str(state["frame"]),
        "__REFERENCE_B64__":base64.b64encode(artifacts["reference"]).decode("ascii"),
    }
    page=HTML
    for marker,value in substitutions.items():
        if page.count(marker)!=1:
            raise ValueError("Missing/ambiguous HTML marker "+marker)
        page=page.replace(marker,value)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(page,encoding="utf-8")
    result={
        "schema":SCHEMA,"status":"REAL_VRAM_REPLAY_READY_NOT_PIXEL_VERIFIED",
        "source_frame":state["frame"],
        "source_driver":state["system"],
        "source_capture_sha256":hashlib.sha256(
            (reference_dir/"manifest.json").read_bytes()).hexdigest(),
        "graphics_rom_part_sha256":part_hashes,
        "html":str(out),"html_sha256":hashlib.sha256(page.encode()).hexdigest(),
        "genuine_rom_derived_video_state":True,
        "js_cpu_emulator":False,
        "js_original_game_logic_running":False,
        "js_pixel_equivalence_verified":False,
    }
    (out.parent/"frame-compare.report.json").write_text(
        json.dumps(result,indent=2,sort_keys=True)+"\n")
    return result


def main()->None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom",type=Path,default=Path("roms/gng.zip"))
    parser.add_argument("--shared",type=Path)
    parser.add_argument("--reference",type=Path,default=Path("out/reference/mame"))
    parser.add_argument("--out",type=Path,default=Path("out/visual/frame-compare.html"))
    args=parser.parse_args()
    try:
        result=build(args.rom,args.reference,args.out,args.shared)
    except (ValueError,OSError,KeyError,json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print("GNG_REAL_VIDEO_REPLAY=GENERATED frame="+str(result["source_frame"]))
    print("GNG_REAL_VIDEO_REPLAY_HTML="+str(args.out))
    print("GNG_JS_FRAME_PIXEL_EQUIVALENCE=NOT_ESTABLISHED requires browser comparison")

if __name__=="__main__":
    main()
