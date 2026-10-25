#!/usr/bin/env python3
"""R4.2.F: validate optional private MAME Lua video-write timeline.

Structural validation only. MAME ownership, exact raster, IRQ, PC/bank identity
and completeness before autoboot tap installation cannot be established here.
Never treat this as A0.6.3 or R4/V2 native equivalence.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

SCHEMA="gng.r42f.native-video-metadata.v1"
FIELDS={"seq","kind","frame","emu_seconds","raster_vpos","raster_hpos",
        "raster_unobserved","address","data","mask"}
MAX_EVENTS=1_000_000


def _exact_int(value:object,lo:int,hi:int)->bool:
    return type(value) is int and lo<=value<=hi


def _unique_keys(pairs:list[tuple[str,object]])->dict:
    out={}
    for k,v in pairs:
        if k in out:
            raise ValueError("R42F_DUPLICATE_JSON_KEY")
        out[k]=v
    return out


def _json(raw:bytes|str)->dict:
    value=json.loads(raw,object_pairs_hook=_unique_keys)
    if type(value) is not dict:
        raise ValueError("R42F_JSON_OBJECT_REQUIRED")
    return value


def _addr_valid(kind:str,addr:int)->bool:
    if kind=="DMA":
        return addr==0x3c00
    return (0x1e00<=addr<=0x2fff or 0x3800<=addr<=0x39ff
            or 0x3b08<=addr<=0x3b0b)


def validate_r42f(directory:Path,*,run_id:str,frame:int,
                  driver:str,dma_count:int)->dict:
    """Validate complete on-disk JSONL against metadata and R0 DMA state."""
    if (type(run_id) is not str or len(run_id)!=32 or
            any(c not in "0123456789abcdef" for c in run_id)):
        raise ValueError("R42F_RUN_ID_INVALID")
    path=Path(directory)/"r42f-native-events.jsonl"
    meta_path=Path(directory)/"r42f-native-metadata.json"
    meta=_json(meta_path.read_bytes())
    if (meta.get("schema")!=SCHEMA or meta.get("run_id")!=run_id or
            meta.get("driver")!=driver or
            meta.get("coverage")!="POST_AUTOBOOT_TAP_INSTALL_ONLY" or
            meta.get("raster_precision")!="UNAVAILABLE_LUA_DOCUMENTED_API" or
            meta.get("instruction_alignment_verified") is not False or
            meta.get("native_vblank_alignment_verified") is not False or
            meta.get("target_frame")!=frame or
            not _exact_int(meta.get("last_frame"),frame,7200) or
            not _exact_int(meta.get("event_count"),1,MAX_EVENTS) or
            not _exact_int(meta.get("write_count"),0,MAX_EVENTS) or
            not _exact_int(meta.get("dma_count"),1,MAX_EVENTS) or
            not _exact_int(meta.get("checkpoint_count"),1,1) or
            meta["dma_count"]!=dma_count):
        raise ValueError("R42F_METADATA_OR_RUN_BINDING_INVALID")
    h=hashlib.sha256()
    count=writes=dmas=checkpoints=0
    previous_frame=-1
    previous_time=-1.0
    with path.open("rb") as handle:
        for line in handle:
            h.update(line)
            if count>=MAX_EVENTS or not line.endswith(b"\n"):
                raise ValueError("R42F_TRACE_TOO_LONG_OR_TRUNCATED")
            row=_json(line)
            if set(row)!=FIELDS or not _exact_int(row.get("seq"),count,count):
                raise ValueError("R42F_TRACE_SEQUENCE_OR_FIELDS_INVALID")
            f=row["frame"]
            t=row["emu_seconds"]
            if (not _exact_int(f,0,7200) or f<previous_frame or
                    type(t) not in (int,float) or not math.isfinite(t) or
                    t<0 or t<previous_time or
                    row["raster_vpos"] is not None or
                    row["raster_hpos"] is not None or
                    row["raster_unobserved"] is not True):
                raise ValueError("R42F_FRAME_TIME_OR_RASTER_INVALID")
            kind=row["kind"]
            if kind in ("DMA","WRITE8"):
                if (checkpoints or not _exact_int(row["address"],0,65535) or
                        not _exact_int(row["data"],0,255) or
                        not _exact_int(row["mask"],255,255) or
                        not _addr_valid(kind,row["address"])):
                    raise ValueError("R42F_BUS_EVENT_INVALID")
                if kind=="DMA":
                    dmas+=1
                else:
                    writes+=1
            elif kind=="CHECKPOINT":
                checkpoints+=1
                if (checkpoints!=1 or row["address"] is not None or
                        row["data"] is not None or row["mask"] is not None or
                        f!=meta["last_frame"]):
                    raise ValueError("R42F_CHECKPOINT_INVALID")
            else:
                raise ValueError("R42F_EVENT_KIND_INVALID")
            count+=1
            previous_frame=f
            previous_time=t
    if (count!=meta["event_count"] or writes!=meta["write_count"] or
            dmas!=meta["dma_count"] or checkpoints!=1 or
            count!=writes+dmas+checkpoints):
        raise ValueError("R42F_TRACE_COUNTS_MISMATCH")
    return {
        "schema":"gng.r42f.native-timeline-validation.v1",
        "status":"STRUCTURAL_TIMELINE_VERIFIED_ORIGIN_UNATTESTED",
        "source":"MAME_LUA_WRITE_TAP_CLAIM_UNATTESTED",
        "run_id":run_id,
        "driver":driver,
        "target_frame":frame,
        "last_frame":meta["last_frame"],
        "events":count,"writes":writes,"dma":dmas,"checkpoints":checkpoints,
        "jsonl_sha256":h.hexdigest(),
        "metadata_sha256":hashlib.sha256(meta_path.read_bytes()).hexdigest(),
        "coverage":meta["coverage"],
        "raster_precision":meta["raster_precision"],
        "instruction_alignment_verified":False,
        "bank_identity_verified":False,
        "native_vblank_alignment_verified":False,
        "native_pixel_equivalence_verified":False,
        "game_playable":False,
    }
