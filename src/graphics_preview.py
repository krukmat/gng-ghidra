#!/usr/bin/env python3
"""Offline, inspectable ROM graphics viewer for Ghosts 'n Goblins gngb.

This is the first **visible** artifact, not a playable game or graphics
rendered from live CPU execution. Raw graphic pixels come from the owner's
ZIP; only this decoder/viewer source is committed to Git. The generated
HTML and ROM-derived pixels live in ignored out/.
MAME 6809 GnG driver source: src/mame/capcom/gng.cpp, char/tile/sprite layouts.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import zipfile
import zlib

SCHEMA = "gng.visible-rom-graphics.v1"
# MAME gngb ROM definition, gfx regions only: name -> (length, CRC32, region, offset)
PARTS = {
    "gg1.bin": (0x4000, 0xecfccf07, "chars", 0),
    "gg11.bin": (0x4000, 0xddd56fa9, "tiles", 0),
    "gg10.bin": (0x4000, 0x7302529d, "tiles", 0x4000),
    "gg9.bin": (0x4000, 0x20035bda, "tiles", 0x8000),
    "gg8.bin": (0x4000, 0xf12ba271, "tiles", 0xc000),
    "gg7.bin": (0x4000, 0xe525207d, "tiles", 0x10000),
    "gg6.bin": (0x4000, 0x2d77e9b2, "tiles", 0x14000),
    "gg17.bin": (0x4000, 0x93e50a8f, "sprites", 0),
    "gg16.bin": (0x4000, 0x06d7e5ca, "sprites", 0x4000),
    "gg15.bin": (0x4000, 0xbc1fe02d, "sprites", 0x8000),
    "gg14.bin": (0x4000, 0x6aaf12f9, "sprites", 0x10000),
    "gg13.bin": (0x4000, 0xe80c3fca, "sprites", 0x14000),
    "gg12.bin": (0x4000, 0x7780a925, "sprites", 0x18000),
}
SIZES = {"chars": 0x4000, "tiles": 0x18000, "sprites": 0x20000}
# Sprites region has a deliberate 0x4000-byte gap (0xc000..0xffff).
ERASE = {"chars": 0x00, "tiles": 0x00, "sprites": 0xff}


def read_part(archives: list[Path], name: str, length: int, crc: int) -> bytes:
    found = []
    for path in archives:
        with zipfile.ZipFile(path) as z:
            hits = [n for n in z.namelist() if n.rsplit("/", 1)[-1].lower() == name]
            if len(hits) > 1:
                raise ValueError(f"{path}: ambiguous duplicate ROM component {name}")
            if hits:
                data = z.read(hits[0])
                if len(data) != length or zlib.crc32(data) != crc:
                    raise ValueError(f"{path}: {name} has wrong size/CRC; expected gngb graphics revision")
                found.append(data)
    if not found:
        raise ValueError(
            f"Missing {name}. Supply the parent/shared archive with --shared "
            "if your gngb ZIP is a split ROM set. No download or upload required."
        )
    if any(v != found[0] for v in found[1:]):
        raise ValueError(f"{name}: conflicting copies in provided archives")
    return found[0]


def load_regions(archives: list[Path]) -> tuple[dict[str, bytes], dict[str, str]]:
    if not archives:
        raise ValueError("At least one local ZIP is required")
    for path in archives:
        if not path.is_file():
            raise ValueError(f"ROM ZIP does not exist: {path}")
    arrays = {name: bytearray([ERASE[name]]) * length
              for name, length in SIZES.items()}
    digests = {}
    for name, (length, crc, region, offset) in PARTS.items():
        part = read_part(archives, name, length, crc)
        arrays[region][offset:offset + length] = part
        digests[name] = hashlib.sha256(part).hexdigest()
    return {name: bytes(region) for name, region in arrays.items()}, digests


HTML = r"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GNG | ROM graphics inspector</title>
<style>
:root{color-scheme:dark;background:#0b1020;color:#e8edf7;font-family:system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 30% 0%,#22304f 0%,#0b1020 52%)}
main{max-width:1160px;margin:auto;padding:28px 18px 60px}
h1{font-size:clamp(23px,4vw,36px);letter-spacing:-.035em;margin:6px 0 6px}
.lead{color:#b5bfd4;max-width:760px;line-height:1.55}
.eyebrow{letter-spacing:.16em;text-transform:uppercase;color:#8ed7d0;font-weight:700;font-size:11px}
.panel{background:#111b30;border:1px solid #33415d;border-radius:13px;padding:18px;margin-top:18px}
.controls{display:flex;gap:16px;align-items:end;flex-wrap:wrap}
label{font-size:12px;display:grid;gap:6px;color:#c3cee0;font-weight:600}
select,input[type=range]{accent-color:#67e0cf}
select{background:#202d45;color:#fff;border:1px solid #40516b;padding:9px;border-radius:7px;min-width:166px;font-size:14px}
input[type=range]{width:min(320px,62vw);height:35px}
.number{font-variant-numeric:tabular-nums;font-size:15px;font-weight:700;color:#fff}
.sheet-wrap{overflow:auto;background:#0a0f19;border:1px solid #2d3850;border-radius:8px;padding:12px;margin-top:18px}
canvas{image-rendering:pixelated;image-rendering:crisp-edges;display:block}
#sheet{width:100%;max-width:960px;cursor:crosshair}
#detail{width:192px;height:192px;background:#0c1526;border:1px solid #33415d}
.detail-row{display:flex;gap:22px;align-items:center;flex-wrap:wrap}
.note{color:#93a7c4;line-height:1.5;font-size:13px}
strong{color:#f0f5ff}
footer{font-size:12px;color:#91a5bc;margin-top:28px;line-height:1.6}
kbd{font-family:ui-monospace,monospace;background:#24304b;padding:2px 5px;border-radius:4px}
</style>
</head>
<body><main>
<div class="eyebrow">ROM → Gráficos · Inspección local</div>
<h1>Ghosts 'n Goblins — gráficos originales</h1>
<p class="lead">Primer resultado visual comprobable. Los píxeles se decodifican de los chips gráficos de tu ROM, usando las distribuciones de bits de la placa arcade. Sin emulador y sin transferir archivos. Esto <strong>no</strong> es todavía una pantalla del juego en ejecución.</p>
<section class="panel">
<div class="controls">
<label>Contenido<select id="kind">
<option value="sprites">Sprites · 16×16 · 4 bpp</option>
<option value="tiles">Escenario · 16×16 · 3 bpp</option>
<option value="chars">Texto · 8×8 · 2 bpp</option></select></label>
<label>Página (128 elementos)
<input id="page" type="range" min="0" max="7" step="1" value="0"></label>
<div class="number" id="range">0–127 / 1024</div>
</div>
<div class="sheet-wrap"><canvas id="sheet" width="256" height="128" aria-label="Hoja de gráficos originales"></canvas></div>
<p class="note">Haz clic sobre un elemento para ampliarlo. Los colores son una <strong>paleta de inspección</strong>, no la paleta dinámica del arcade: el color real requiere interpretar la memoria de vídeo.</p>
</section>
<section class="panel">
<div class="detail-row">
<canvas id="detail" width="16" height="16" aria-label="Elemento seleccionado"></canvas>
<div><div class="eyebrow">Elemento</div><h2 id="selection">Sprite #0</h2>
<div class="note" id="details">Píxeles decodificados de la ROM local</div>
</div></div>
</section>
<footer>
<strong>Procedencia:</strong> ROM gngb verificada por tamaño y CRC32 antes de construir esta página. Formatos basados en <a style="color:#89dfd4" href="https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp">MAME gng.cpp, gfx_layout</a>.
No hay CPU, física, colisiones, sonido, framebuffer del juego ni partida ejecutándose. El HTML contiene píxeles derivados de tu ROM y se guarda solo en tu equipo; no lo publiques.
</footer>
</main>
<script>
"use strict";
const B64=__PAYLOAD__;
const regions={};
for(const [name,blob] of Object.entries(B64)){
 const bytes=atob(blob),v=new Uint8Array(bytes.length);
 for(let i=0;i<bytes.length;i++)v[i]=bytes.charCodeAt(i);
 regions[name]=v;
}
const dims={sprites:16,tiles:16,chars:8};
const names={sprites:"Sprite",tiles:"Escenario",chars:"Carácter"};
const palettes={
 sprites:["#101b30","#ede4cb","#98cabf","#f3a34c","#d45b52","#a6b7e3","#ba7fd2","#72ac78","#f3d47e","#57788a","#d9a1ad","#71558b","#9b693e","#c1c2ad","#db9253","#f8f6e8"],
 tiles:["#0e1b30","#4c766c","#689d80","#c0bc72","#c87b50","#b1a2bd","#e0cc99","#ffffff"],
 chars:["#0d1728","#699d9c","#d4bc80","#f5f3e9"]
};
function oneBit(buf,at){
 if(at<0||at>=buf.length*8)throw Error("Graphics address out of bounds");
 return (buf[at>>>3]>>>(7-(at&7)))&1;
}
function pixel(kind,index,x,y){
 const buf=regions[kind];
 if(kind==="chars"){
  const pos=index*128+y*16+(x<4?x:x+4);
  return (oneBit(buf,pos+4)<<0)|(oneBit(buf,pos)<<1);
 }
 if(kind==="tiles"){
  const p=index*256+y*8+(x<8?x:128+x-8);
  return (oneBit(buf,p+0x10000*8)<<0)|
         (oneBit(buf,p+0x8000*8)<<1)|
         (oneBit(buf,p)<<2);
 }
 const p=index*512+y*16+(x<8?(x<4?x:x+4):256+(x<12?x-8:x-4));
 return (oneBit(buf,p+0x10000*8+4)<<0)|
        (oneBit(buf,p+0x10000*8)<<1)|
        (oneBit(buf,p+4)<<2)|
        (oneBit(buf,p)<<3);
}
function drawElement(ctx,kind,index,dx,dy){
 const n=dims[kind],colors=palettes[kind];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   ctx.fillStyle=colors[pixel(kind,index,x,y)];
   ctx.fillRect(dx+x,dy+y,1,1);
 }
}
const kind=document.getElementById("kind");
const page=document.getElementById("page");
const sheet=document.getElementById("sheet");
const detail=document.getElementById("detail");
let selected=0;
function draw(){
 const k=kind.value,n=dims[k],p=Number(page.value);
 sheet.width=n*16;sheet.height=n*8;
 const c=sheet.getContext("2d",{alpha:false});
 c.fillStyle="#0c1424";c.fillRect(0,0,sheet.width,sheet.height);
 for(let i=0;i<128;i++)drawElement(c,k,p*128+i,(i%16)*n,Math.floor(i/16)*n);
 document.getElementById("range").textContent=
  String(p*128)+"–"+String(p*128+127)+" / 1024";
 selected=p*128;
 drawSelected();
}
function drawSelected(){
 const k=kind.value,n=dims[k];
 detail.width=n;detail.height=n;
 drawElement(detail.getContext("2d"),k,selected,0,0);
 document.getElementById("selection").textContent=names[k]+" #"+selected;
 document.getElementById("details").textContent=n+"×"+n+" píxeles · índice ROM "+selected+
    " · no es un frame del juego";
}
kind.addEventListener("change",()=>{page.value="0";draw();});
page.addEventListener("input",draw);
sheet.addEventListener("click",e=>{
 const rect=sheet.getBoundingClientRect(),n=dims[kind.value];
 const x=Math.min(sheet.width-1,Math.floor((e.clientX-rect.left)/rect.width*sheet.width));
 const y=Math.min(sheet.height-1,Math.floor((e.clientY-rect.top)/rect.height*sheet.height));
 selected=Number(page.value)*128+Math.floor(y/n)*16+Math.floor(x/n);
 drawSelected();
});
window.addEventListener("keydown",e=>{
 if(e.target?.tagName==="SELECT"||e.target?.tagName==="INPUT")return;
 if(e.key==="ArrowRight"&&Number(page.value)<7){page.value=Number(page.value)+1;draw();}
 if(e.key==="ArrowLeft"&&Number(page.value)>0){page.value=Number(page.value)-1;draw();}
});
draw();
</script></body></html>
"""


def build(rom: Path, out: Path, shared: Path | None = None) -> dict:
    archives = [rom] + ([shared] if shared is not None and shared != rom else [])
    regions, parts = load_regions(archives)
    payload = {name: base64.b64encode(data).decode("ascii")
               for name, data in regions.items()}
    page = HTML.replace("__PAYLOAD__", json.dumps(payload, separators=(",", ":")))
    if "__PAYLOAD__" in page:
        raise RuntimeError("Payload placeholder not substituted")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    report = {
        "schema": SCHEMA,
        "status": "VISUAL_ASSET_INSPECTOR_ONLY",
        "viewer": str(out),
        "viewer_sha256": hashlib.sha256(page.encode("utf-8")).hexdigest(),
        "rom_part_sha256": parts,
        "graphics": {
            "chars": {"count": 1024, "size": [8, 8], "bpp": 2},
            "tiles": {"count": 1024, "size": [16, 16], "bpp": 3},
            "sprites": {"count": 1024, "size": [16, 16], "bpp": 4},
        },
        "playable": False,
        "rendered_from_live_cpu_ram": False,
        "actual_arcade_palette": False,
        "rom_bytes_embedded_in_local_html": True,
    }
    (out.parent / "graphics-preview.manifest.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rom", type=Path, default=Path("roms/gng.zip"),
                    help="Local gngb-compatible ZIP, never uploaded")
    ap.add_argument("--shared", type=Path,
                    help="Optional parent ROM ZIP for missing common graphic chips")
    ap.add_argument("--out", type=Path, default=Path("out/graphics-preview.html"))
    args = ap.parse_args()
    try:
        report = build(args.rom, args.out, args.shared)
    except (ValueError, zipfile.BadZipFile, OSError) as exc:
        ap.error(str(exc))
    print("GNG_VISUAL_PREVIEW=GENERATED gfx=3 assets=13"
          " playable=false palette=inspection-only")
    print("GNG_VISUAL_PREVIEW_HTML=" + report["viewer"])
    print("GNG_REAL_GAME_RENDERING=NOT_IMPLEMENTED")


if __name__ == "__main__":
    main()
