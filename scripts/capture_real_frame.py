#!/usr/bin/env python3
"""Capture an actual MAME-rendered GnG frame plus video-state evidence.

Test-only oracle: private image/memory stays in ignored out/.
No MAME in generated JS runtime. Never substitute synthetic fixture data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess

SCHEMA="gng.mame-video-capture.v1"
FILES={
    "foreground":"foreground.bin",
    "background":"background.bin",
    "sprites":"sprites-buffered.bin",
    "palette":"palette-rgba.bin",
}
SIZES={"foreground":0x800,"background":0x800,"sprites":0x200,"palette":0x400}


def png_size(path:Path)->tuple[int,int]:
    raw=path.read_bytes()
    if len(raw)<33 or not raw.startswith(b"\x89PNG\r\n\x1a\n") or raw[12:16]!=b"IHDR":
        raise ValueError("MAME reference is not a valid PNG header: "+str(path))
    return struct.unpack(">II",raw[16:24])


def validate_capture(directory:Path,requested_frame:int,system:str)->dict:
    state_path=directory/"state.json"
    if not state_path.is_file():
        raise ValueError("MAME did not write state.json: capture script may have failed")
    state=json.loads(state_path.read_text())
    if state.get("schema")!="gng.mame-video-state.v1":
        raise ValueError("Capture state schema missing/unknown")
    if state.get("driver")!=system:
        raise ValueError("Capture driver differs from requested machine")
    if not isinstance(state.get("frame"),int) or state["frame"]<requested_frame:
        raise ValueError("MAME exited before requested video frame")
    if not isinstance(state.get("dma_count"),int) or state["dma_count"]<=0:
        raise ValueError("No verified sprite DMA snapshot; cannot substitute CPU RAM")
    if (not isinstance(state.get("scroll_bytes"),list) or
            len(state["scroll_bytes"])!=4 or
            any(type(x)is not int or not 0<=x<=255
                for x in state["scroll_bytes"])):
        raise ValueError("Captured hardware scroll bytes missing/invalid")
    sx,sy=(state["scroll_bytes"][0]+256*state["scroll_bytes"][1],
           state["scroll_bytes"][2]+256*state["scroll_bytes"][3])
    if (sx!=state.get("scroll_x") or sy!=state.get("scroll_y") or
            not 0<=sx<=65535 or not 0<=sy<=65535):
        raise ValueError("Scroll register reconstruction mismatch")
    digest={}
    for key,name in FILES.items():
        path=directory/name
        if not path.is_file():
            raise ValueError("Missing MAME VRAM evidence: "+name)
        data=path.read_bytes()
        if len(data)!=SIZES[key]:
            raise ValueError(f"MAME {key} evidence length changed: {len(data)}")
        digest[key]={"filename":name,"bytes":len(data),
                     "sha256":hashlib.sha256(data).hexdigest()}
    png=directory/"reference.png"
    if not png.is_file():
        raise ValueError("Missing independent MAME screen screenshot")
    width,height=png_size(png)
    if (width,height)!=(256,224):
        raise ValueError(f"Unexpected MAME screen crop: {width}x{height}, "
                         "expected 256x224 native pixels")
    digest["reference"]={
        "filename":"reference.png","width":width,"height":height,
        "sha256":hashlib.sha256(png.read_bytes()).hexdigest()}
    return {
        "schema":SCHEMA,"status":"NATIVE_REFERENCE_CAPTURED_NOT_JS_EQUIVALENCE",
        "system":system,"frame":state["frame"],"sprite_dma_count":state["dma_count"],
        "scroll_x":sx,"scroll_y":sy,"cpu_pc":state.get("pc"),
        "artifacts":digest,"source":"MAME reference frame only",
        "sprite_dma_observed":True,
        "native_video_state_validated":True,
        "generated_js_frame_equivalent":False,
        "product_uses_mame":False,
        "notes":"MAME frame callback and last DMA state may differ at raster precision",
    }


def command(mame:str,system:str,rompath:Path,lua:Path)->list[str]:
    if system not in {"gng","gngb"}:
        raise ValueError("Only GNG/GNGB MAME drivers are supported")
    return [mame,system,"-rompath",str(rompath),"-autoboot_script",str(lua),
            "-window","-nothrottle","-sound","none","-skip_gameinfo"]


def capture(mame:str,system:str,rompath:Path,directory:Path,frame:int,
            *,dry_run:bool=False,timeout:int=180)->dict:
    if not 2<=frame<=7200:
        raise ValueError("Capture frame must be between 2 and 7200")
    root=Path(__file__).resolve().parents[1]
    lua=(root/"scripts/capture-mame-frame.lua").resolve()
    if not lua.is_file():
        raise ValueError("MAME Lua reference script missing")
    rompath=rompath.resolve()
    if not rompath.is_dir():
        raise ValueError("MAME ROM directory missing: "+str(rompath))
    directory=directory.resolve()
    if directory==root or root not in directory.parents:
        raise ValueError("Reference evidence must remain inside this repo")
    if "out" not in directory.relative_to(root).parts:
        raise ValueError("Reference evidence MUST be written inside ignored out/")
    plan=command(mame,system,rompath,lua)
    if dry_run:
        return {"status":"DRY_RUN_NOT_CAPTURED","command":plan,
                "output":str(directory),"frame":frame}
    if not shutil.which(mame) and not Path(mame).is_file():
        raise ValueError("MAME not installed/on PATH. Check command -v mame on macOS. "
                         "This is a test-only reference tool.")
    directory.mkdir(parents=True,exist_ok=True)
    for filename in [*FILES.values(),"reference.png","state.json","manifest.json"]:
        (directory/filename).unlink(missing_ok=True)
    env=os.environ.copy()
    env["GNG_CAPTURE_DIR"]=str(directory)
    env["GNG_CAPTURE_FRAME"]=str(frame)
    try:
        result=subprocess.run(plan,env=env,capture_output=True,text=True,
                              timeout=timeout,check=False)
    except subprocess.TimeoutExpired as exc:
        raise ValueError("MAME timed out; no reference accepted") from exc
    if result.returncode!=0:
        raise ValueError("MAME reference capture failed:\n"+
                         (result.stderr+"\n"+result.stdout)[-3000:])
    manifest=validate_capture(directory,frame,system)
    (directory/"manifest.json").write_text(
        json.dumps(manifest,indent=2,sort_keys=True)+"\n")
    return manifest


def main()->None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mame",default="mame")
    parser.add_argument("--system",choices=["gngb","gng"],default="gngb")
    parser.add_argument("--rompath",type=Path,default=Path("roms"))
    parser.add_argument("--out",type=Path,default=Path("out/reference/mame"))
    parser.add_argument("--frame",type=int,default=600)
    parser.add_argument("--dry-run",action="store_true")
    args=parser.parse_args()
    try:
        result=capture(args.mame,args.system,args.rompath,args.out,args.frame,
                       dry_run=args.dry_run)
    except (OSError,ValueError,json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print("GNG_MAME_CAPTURE="+result["status"])
    if args.dry_run:
        print("  argv="+json.dumps(result["command"]))
    else:
        print("  frame="+str(result["frame"])+" sprite_dma="+
              str(result["sprite_dma_count"])+
              " scroll="+str([result["scroll_x"],result["scroll_y"]]))
        print("GNG_MAME_CAPTURE_MANIFEST="+str(args.out/"manifest.json"))
    print("GNG_JS_VISUAL_EQUIVALENCE=NOT_ESTABLISHED")


if __name__=="__main__":
    main()
