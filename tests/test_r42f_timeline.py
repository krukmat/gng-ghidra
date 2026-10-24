"""ROM-free tests for R4.2.F's native timeline *structural* validator."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from r42f_validate_timeline import validate_r42f

RUN="0123456789abcdef0123456789abcdef"


def event(seq,kind,addr=None,value=None,mask=None,frame=600,time=None):
    return {
        "seq":seq,"kind":kind,"address":addr,"data":value,"mask":mask,
        "frame":frame,"emu_seconds":0.5+seq/1000 if time is None else time,
        "raster_vpos":None,"raster_hpos":None,"raster_unobserved":True,
    }


def fixture(path:Path):
    events=[
        event(0,"WRITE8",0x1e00,45,255),
        event(1,"WRITE8",0x2800,0,255),
        event(2,"DMA",0x3c00,0,255),
        event(3,"CHECKPOINT"),
    ]
    meta={
        "schema":"gng.r42f.native-video-metadata.v1",
        "run_id":RUN,"driver":"gngb","target_frame":600,"last_frame":600,
        "event_count":4,"write_count":2,"dma_count":1,"checkpoint_count":1,
        "coverage":"POST_AUTOBOOT_TAP_INSTALL_ONLY",
        "raster_precision":"UNAVAILABLE_LUA_DOCUMENTED_API",
        "instruction_alignment_verified":False,
        "native_vblank_alignment_verified":False,
    }
    write(path,events,meta)
    return events,meta


def write(path,events,meta):
    (path/"r42f-native-events.jsonl").write_text(
        "".join(json.dumps(e,separators=(",",":"))+"\n" for e in events))
    (path/"r42f-native-metadata.json").write_text(json.dumps(meta))


def validate(path):
    return validate_r42f(path,run_id=RUN,frame=600,driver="gngb",dma_count=1)


class VideoTimelineTests(unittest.TestCase):
    def test_structure_and_hashes_never_certify_cpu_raster_or_bank(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)
            fixture(path)
            r=validate(path)
            self.assertEqual(r["status"],
                "STRUCTURAL_TIMELINE_VERIFIED_ORIGIN_UNATTESTED")
            self.assertEqual([r["events"],r["writes"],r["dma"]],[4,2,1])
            self.assertRegex(r["jsonl_sha256"],r"^[0-9a-f]{64}$")
            self.assertFalse(r["instruction_alignment_verified"])
            self.assertFalse(r["bank_identity_verified"])
            self.assertFalse(r["native_vblank_alignment_verified"])

    def test_corrupted_order_reordered_clock_and_dropped_line_reject(self):
        for defect in ("sequence","time","missing"):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as d:
                path=Path(d);events,meta=fixture(path)
                if defect=="sequence":events[1]["seq"]=3
                if defect=="time":events[2]["emu_seconds"]=0.1
                if defect=="missing":events.pop(1)
                write(path,events,meta)
                with self.assertRaisesRegex(ValueError,
                        "SEQUENCE|TIME_OR_RASTER|COUNTS"):
                    validate(path)

    def test_mask_address_dma_and_metadata_tamper_reject(self):
        for defect in ("mask","address","dma","run","frame"):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as d:
                path=Path(d);events,meta=fixture(path)
                if defect=="mask":events[0]["mask"]=0xffff
                if defect=="address":events[0]["address"]=0x3e00
                if defect=="dma":meta["dma_count"]=2
                if defect=="run":meta["run_id"]="f"*32
                if defect=="frame":meta["last_frame"]=601
                write(path,events,meta)
                with self.assertRaisesRegex(ValueError,"R42F_"):
                    validate(path)

    def test_raster_claim_or_synthetic_vblank_credential_reject(self):
        for defect in ("vpos","unobserved","vblank","alignment"):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as d:
                path=Path(d);events,meta=fixture(path)
                if defect=="vpos":events[1]["raster_vpos"]=17
                if defect=="unobserved":events[1]["raster_unobserved"]=False
                if defect=="vblank":meta["native_vblank_alignment_verified"]=True
                if defect=="alignment":meta["instruction_alignment_verified"]=True
                write(path,events,meta)
                with self.assertRaisesRegex(ValueError,"R42F_"):
                    validate(path)

    def test_duplicate_json_keys_missing_final_checkpoint_and_truncation(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d);events,meta=fixture(path)
            events[-1]["kind"]="WRITE8";events[-1]["address"]=0x2000
            events[-1]["data"]=0;events[-1]["mask"]=255
            write(path,events,meta)
            with self.assertRaisesRegex(ValueError,"R42F_"):
                validate(path)
            fixture(path)
            with (path/"r42f-native-events.jsonl").open("ab") as f:
                f.write(b'{"seq":4,')
            with self.assertRaisesRegex(ValueError,"R42F_"):
                validate(path)
            fixture(path)
            f=path/"r42f-native-events.jsonl"
            lines=f.read_text().splitlines()
            lines[0]=lines[0].replace('"seq":0,','"seq":0,"seq":0,')
            f.write_text("\n".join(lines)+"\n")
            with self.assertRaisesRegex(ValueError,"R42F_DUPLICATE_JSON_KEY"):
                validate(path)

    def test_lua_tap_contract_and_wrapper_flag_exist(self):
        lua=(ROOT/"scripts/r42f_native_video_taps.lua").read_text()
        parent=(ROOT/"scripts/capture-mame-frame.lua").read_text()
        wrapper=(ROOT/"scripts/capture_real_frame.py").read_text()
        self.assertIn("install_write_tap(0x1e00",lua.replace("tap(","install_write_tap("))
        self.assertIn("tap(0x3800,0x39ff",lua)
        self.assertIn('if r42f then r42f.scroll_tap',parent)
        self.assertIn('if r42f then r42f.dma_tap',parent)
        self.assertIn('--r42f-timeline',wrapper)
        self.assertIn('validate_r42f(directory',wrapper)
        self.assertIn('r42f-native-metadata.json',wrapper)


if __name__=="__main__":
    unittest.main()
