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
import secrets
from pathlib import Path
import shutil
import struct
import subprocess

BOT_CHECKPOINTS=(920,980,1060,1300,1510,1660)

# Both direct CLI invocation and importlib-loaded ROM-free tests work.
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from r0_bot_sequence import prepare_sequence, check_replay
from r42f_validate_timeline import validate_r42f

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


def validate_capture(directory:Path,requested_frame:int,system:str,
                     expected_replay:dict|None=None)->dict:
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
    replay=check_replay(state,expected_replay)
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
    bot_checkpoint_evidence=[]
    if expected_replay is not None:
        for number in BOT_CHECKPOINTS:
            if number>=requested_frame:
                raise ValueError("Bot final frame must be after all checkpoints")
            filename=f"frame-{number:04d}.png"
            checkpoint=directory/"checkpoints"/filename
            if not checkpoint.is_file() or png_size(checkpoint)!=(256,224):
                raise ValueError("Missing/wrong-sized MAME boot checkpoint: "+filename)
            bot_checkpoint_evidence.append({
                "frame":number,"file":filename,
                "sha256":hashlib.sha256(checkpoint.read_bytes()).hexdigest()})
    return {
        "schema":SCHEMA,"status":"NATIVE_REFERENCE_CAPTURED_NOT_JS_EQUIVALENCE",
        "system":system,"frame":state["frame"],"sprite_dma_count":state["dma_count"],
        "scroll_x":sx,"scroll_y":sy,"cpu_pc":state.get("pc"),
        "artifacts":digest,"source":"MAME reference frame only",
        "sprite_dma_observed":True,
        "native_video_state_validated":True,
        "generated_js_frame_equivalent":False,
        "input_replay":replay,
        "bot_checkpoints":bot_checkpoint_evidence,
        "product_uses_mame":False,
        "notes":"MAME frame callback and last DMA state may differ at raster precision",
    }


def command(mame:str,system:str,rompath:Path,lua:Path)->list[str]:
    if system not in {"gng","gngb"}:
        raise ValueError("Only GNG/GNGB MAME drivers are supported")
    return [mame,system,"-rompath",str(rompath),"-autoboot_script",str(lua),
            "-window","-nothrottle","-sound","none","-skip_gameinfo"]


def capture(mame:str,system:str,rompath:Path,directory:Path,frame:int,
            *,dry_run:bool=False,timeout:int=180,
            bot_sequence:Path|None=None,r42f_timeline:bool=False)->dict:
    if not 2<=frame<=7200:
        raise ValueError("Capture frame must be between 2 and 7200")
    root=Path(__file__).resolve().parents[1]
    lua=(root/"scripts/capture-mame-frame.lua").resolve()
    if not lua.is_file():
        raise ValueError("MAME Lua reference script missing")
    r42f_module=(root/"scripts/r42f_native_video_taps.lua").resolve()
    if r42f_timeline and not r42f_module.is_file():
        raise ValueError("R42F MAME Lua tap module missing")
    rompath=rompath.resolve()
    if not rompath.is_dir():
        raise ValueError("MAME ROM directory missing: "+str(rompath))
    directory=directory.resolve()
    if directory==root or root not in directory.parents:
        raise ValueError("Reference evidence must remain inside this repo")
    if "out" not in directory.relative_to(root).parts:
        raise ValueError("Reference evidence MUST be written inside ignored out/")
    replay=prepare_sequence(bot_sequence,frame) if bot_sequence else None
    plan=command(mame,system,rompath,lua)
    if dry_run:
        return {"status":"DRY_RUN_NOT_CAPTURED","command":plan,
                "output":str(directory),"frame":frame,
                "r42f_timeline_requested":r42f_timeline,
                "input_replay":None if not replay else {
                    "sha256":replay["sha256"],"events":replay["event_count"]}}
    if not shutil.which(mame) and not Path(mame).is_file():
        raise ValueError("MAME not installed/on PATH. Check command -v mame on macOS. "
                         "This is a test-only reference tool.")
    directory.mkdir(parents=True,exist_ok=True)
    for filename in [*FILES.values(),"reference.png","state.json",
                     "manifest.json","bot-checkpoints.html","mame.log",
                     "reproducibility.json",
                     "r42f-native-events.jsonl","r42f-native-metadata.json"]:
        (directory/filename).unlink(missing_ok=True)
    if replay:
        (directory/"checkpoints").mkdir(exist_ok=True)
        for number in BOT_CHECKPOINTS:
            (directory/"checkpoints"/f"frame-{number:04d}.png").unlink(missing_ok=True)
    env=os.environ.copy()
    env["GNG_CAPTURE_DIR"]=str(directory)
    env["GNG_CAPTURE_FRAME"]=str(frame)
    env.pop("GNG_BOT_EVENTS",None)
    env.pop("GNG_BOT_SHA256",None)
    for key in ("GNG_R42F_TIMELINE","GNG_R42F_MODULE","GNG_R42F_RUN_ID",
                "GNG_R42F_MAX_EVENTS"):
        env.pop(key,None)
    r42f_run_id=None
    if r42f_timeline:
        r42f_run_id=secrets.token_hex(16)
        env["GNG_R42F_TIMELINE"]="1"
        env["GNG_R42F_MODULE"]=str(r42f_module)
        env["GNG_R42F_RUN_ID"]=r42f_run_id
        env["GNG_R42F_MAX_EVENTS"]="1000000"
    if replay:
        env["GNG_BOT_EVENTS"]=replay["wire"]
        env["GNG_BOT_SHA256"]=replay["sha256"]
    try:
        result=subprocess.run(plan,env=env,capture_output=True,text=True,
                              timeout=timeout,check=False)
    except subprocess.TimeoutExpired as exc:
        raise ValueError("MAME timed out; no reference accepted") from exc
    (directory/"mame.log").write_text(result.stdout+"\n"+result.stderr)
    if result.returncode!=0:
        raise ValueError("MAME reference capture failed:\n"+
                         (result.stderr+"\n"+result.stdout)[-3000:])
    if replay and "GNG_BOT_FIELDS=RESOLVED_MAME_NAMES" not in result.stdout:
        raise ValueError("MAME bot Lua did not report initialized fields; see private mame.log")
    manifest=validate_capture(directory,frame,system,replay)
    if r42f_timeline:
        timeline=validate_r42f(directory,run_id=r42f_run_id,
                              frame=frame,driver=system,
                              dma_count=manifest["sprite_dma_count"])
        if timeline["last_frame"]!=manifest["frame"]:
            raise ValueError("R42F timeline and R0 final frame disagree")
        manifest["r42f_native_timeline"]=timeline
    if replay:
        pictures="\n".join(
            f'<figure><img src="checkpoints/{item["file"]}" '
            f'width="256" height="224" loading="eager">'
            f'<figcaption>Frame {item["frame"]}</figcaption></figure>'
            for item in manifest["bot_checkpoints"])
        pictures+=f'<figure><img src="reference.png" width="256" height="224">'
        pictures+=f'<figcaption>Frame {frame} (final)</figcaption></figure>'
        page=('<html lang="es"><meta charset="utf-8"><title>GNG — arranque real</title>'
              '<style>body{background:#111;color:white;font:16px system-ui}'
              'main{display:flex;flex-wrap:wrap;gap:16px}'
              'figure{margin:8px}img{image-rendering:pixelated;width:256px;height:224px}'
              '</style><h1>Arranque GNG — capturas reales de MAME</h1>'
              '<p>Coin/Start han sido leídos en los puertos. Eso no demuestra '
              'que el juego haya empezado. Revisa cada etapa.</p>'
              '<main>'+pictures+'</main></html>')
        (directory/"bot-checkpoints.html").write_text(page)
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
    parser.add_argument("--r42f-timeline",action="store_true",
                        help="Private write timeline, without CPU/raster synchronization proof")
    parser.add_argument("--bot-sequence",type=Path,help="JSON frame/input schedule (lab-only)")
    parser.add_argument("--repeats",type=int,default=1,choices=(1,2,3),
                        help="Capture 1–3 independent runs; compare private artifact hashes")
    args=parser.parse_args()
    try:
        result=capture(args.mame,args.system,args.rompath,args.out,args.frame,
                       dry_run=args.dry_run,bot_sequence=args.bot_sequence,
                        r42f_timeline=args.r42f_timeline)
        if args.repeats>1 and not args.dry_run:
            keys=("foreground","background","sprites","palette","reference")
            first={k:result["artifacts"][k]["sha256"] for k in keys}
            for i in range(2,args.repeats+1):
                trial=capture(args.mame,args.system,args.rompath,
                              args.out/f"repeat-{i:02d}",args.frame,
                              bot_sequence=args.bot_sequence,
                               r42f_timeline=args.r42f_timeline)
                other={k:trial["artifacts"][k]["sha256"] for k in keys}
                if (first!=other or result["cpu_pc"]!=trial["cpu_pc"] or
                        result["sprite_dma_count"]!=trial["sprite_dma_count"] or
                        result["input_replay"]!=trial["input_replay"]):
                    raise ValueError(f"MAME replay diverged on repetition {i}")
            (args.out/"reproducibility.json").write_text(json.dumps({
                "schema":"gng.mame-replay-reproducibility.v1",
                "status":"IDENTICAL_ARTIFACT_HASHES",
                "repeats":args.repeats,"sha256":first,
                "bot_sha256":result["input_replay"]["sha256"] if result["input_replay"] else None
            },sort_keys=True,indent=2)+"\n")
            print("GNG_MAME_REPLAY=IDENTICAL_ARTIFACT_HASHES runs="+str(args.repeats))
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
        if args.r42f_timeline:
            print("GNG_R42F_STRUCTURAL_TIMELINE="+
                  result["r42f_native_timeline"]["status"])
        if result["input_replay"]:
            replay=result["input_replay"]
            print("GNG_BOT_INPUTS=OBSERVED coin_frames="+str(replay["effective_coin_frames"])+
                  " start_frames="+str(replay["effective_start_frames"]))
            print("GNG_BOT_VISUAL_GATE=PENDING_REVIEW")
            print("GNG_BOT_CHECKPOINTS="+str(args.out/"bot-checkpoints.html"))
            print("GNG_MAME_PRIVATE_LOG="+str(args.out/"mame.log"))
    print("GNG_JS_VISUAL_EQUIVALENCE=NOT_ESTABLISHED")


if __name__=="__main__":
    main()
