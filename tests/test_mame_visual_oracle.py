"""ROM-free tests of the real-game-reference capture/renderer pipeline.

Use deterministic 256x224 PNG and fake RAM only as TEST FIXTURES. Nothing
here claims a real frame was captured, and no game ROM is checked in.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import zlib

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"src"))
sys.path.insert(0,str(ROOT/"tests"))
from test_graphics_preview import fixture_zips
import graphics_preview
import reference_frame_view as frames

spec=importlib.util.spec_from_file_location(
    "capture_real_frame",ROOT/"scripts/capture_real_frame.py")
capture=importlib.util.module_from_spec(spec)
sys.modules["capture_real_frame"]=capture
spec.loader.exec_module(capture)


def png(width=256,height=224):
    def chunk(label,payload):
        value=label+payload
        return struct.pack(">I",len(payload))+value+struct.pack(
            ">I",zlib.crc32(value))
    data=b"\x89PNG\r\n\x1a\n"
    data+=chunk(b"IHDR",struct.pack(">2I5B",width,height,8,2,0,0,0))
    row=b"\x00"+bytes([30,55,77])*width
    data+=chunk(b"IDAT",zlib.compress(row*height))
    data+=chunk(b"IEND",b"")
    return data


def reference_fixture(folder:Path,driver="gngb",frame=600):
    folder.mkdir(parents=True,exist_ok=True)
    blobs={
        "foreground":bytes([0x43])*0x800,
        "background":bytes([0x78])*0x800,
        "sprites":bytes([0xf8])*0x200,
        "palette":bytes([0x35,0x70,0xb2,0xff])*256,
    }
    for name,data in blobs.items():
        (folder/capture.FILES[name]).write_bytes(data)
    (folder/"reference.png").write_bytes(png())
    state={
        "schema":"gng.mame-video-state.v1","driver":driver,
        "frame":frame,"dma_count":8,"scroll_x":304,"scroll_y":32,
        "scroll_bytes":[48,1,32,0],"pc":0x6000,
        "source":"MAME independent native frame, not translated JS",
        "sprite_buffer_source":"CPU write tap 0x3c00",
    }
    (folder/"state.json").write_text(json.dumps(state))
    manifest=capture.validate_capture(folder,frame,driver)
    (folder/"manifest.json").write_text(json.dumps(manifest))
    return manifest


class MameCaptureTests(unittest.TestCase):
    def test_mac_one_command_wrapper_has_valid_shell_syntax(self):
        shell=ROOT/"scripts/visual-real-frame.sh"
        source=shell.read_text()
        self.assertIn("capture_real_frame.py",source)
        self.assertIn("reference_frame_view.py",source)
        self.assertIn("GNG_JS_PIXEL_EQUIVALENCE=UNVERIFIED",source)
        self.assertNotIn("curl ",source)
        self.assertNotIn("wget ",source)
        if shutil.which("bash"):
            checked=subprocess.run(["bash","-n",str(shell)],
                capture_output=True,text=True,timeout=10)
            self.assertEqual(checked.returncode,0,checked.stderr)

    def test_native_png_size_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            image=Path(tmp)/"native.png"
            image.write_bytes(png())
            self.assertEqual(capture.png_size(image),(256,224))
            image.write_bytes(b"fake-image")
            with self.assertRaisesRegex(ValueError,"PNG"):
                capture.png_size(image)

    def test_complete_reference_with_buffer_and_exact_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            generated=reference_fixture(folder)
            self.assertEqual(generated["status"],
                "NATIVE_REFERENCE_CAPTURED_NOT_JS_EQUIVALENCE")
            self.assertEqual(generated["frame"],600)
            self.assertEqual(generated["sprite_dma_count"],8)
            self.assertEqual(generated["scroll_x"],304)
            self.assertTrue(generated["native_video_state_validated"])
            self.assertFalse(generated["generated_js_frame_equivalent"])
            self.assertFalse(generated["product_uses_mame"])
            self.assertEqual(generated["artifacts"]["reference"]["height"],224)

    def test_missing_dma_invalidates_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            reference_fixture(folder)
            state=json.loads((folder/"state.json").read_text())
            state["dma_count"]=0
            (folder/"state.json").write_text(json.dumps(state))
            with self.assertRaisesRegex(ValueError,"sprite DMA"):
                capture.validate_capture(folder,600,"gngb")

    def test_truncated_memory_and_wrong_scroll_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            reference_fixture(folder)
            (folder/"background.bin").write_bytes(bytes(32))
            with self.assertRaisesRegex(ValueError,"length"):
                capture.validate_capture(folder,600,"gngb")
            (folder/"background.bin").write_bytes(bytes(0x800))
            state=json.loads((folder/"state.json").read_text())
            state["scroll_x"]=999
            (folder/"state.json").write_text(json.dumps(state))
            with self.assertRaisesRegex(ValueError,"Scroll"):
                capture.validate_capture(folder,600,"gngb")

    def test_stale_and_invalid_snapshot_dimensions_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            reference_fixture(folder)
            (folder/"reference.png").write_bytes(png(320,224))
            with self.assertRaisesRegex(ValueError,"Unexpected"):
                capture.validate_capture(folder,600,"gngb")
            (folder/"reference.png").write_bytes(png())
            with self.assertRaisesRegex(ValueError,"before requested"):
                capture.validate_capture(folder,800,"gngb")

    def test_preview_command_is_test_only_and_output_confined(self):
        root=ROOT
        with tempfile.TemporaryDirectory() as rom_directory:
            # CI never has a proprietary ROM; an existing empty directory
            # suffices for a command-construction smoke without MAME.
            plan=capture.capture("mame","gngb",Path(rom_directory),
                root/"out/reference/mame",600,dry_run=True)
            self.assertEqual(plan["status"],"DRY_RUN_NOT_CAPTURED")
            self.assertIn("-autoboot_script",plan["command"])
            self.assertIn("-rompath",plan["command"])
            with self.assertRaisesRegex(ValueError,"inside ignored out"):
                capture.capture("mame","gngb",Path(rom_directory),
                    root/"docs",600,dry_run=True)


class ReferenceFrameViewTests(unittest.TestCase):
    def test_render_same_memory_as_native_reference_without_cpu(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            ref=folder/"ref"
            manifest=reference_fixture(ref)
            rom,shared,parts,other=fixture_zips(folder)
            out=folder/"out"/"visual/frame-compare.html"
            with patch.object(graphics_preview,"PARTS",parts):
                report=frames.build(rom,ref,out,shared)
            self.assertEqual(report["schema"],"gng.real-frame-js-replay.v1")
            self.assertEqual(report["status"],
                "REAL_VRAM_REPLAY_READY_NOT_PIXEL_VERIFIED")
            self.assertTrue(report["genuine_rom_derived_video_state"])
            self.assertFalse(report["js_cpu_emulator"])
            self.assertFalse(report["js_original_game_logic_running"])
            self.assertFalse(report["js_pixel_equivalence_verified"])
            html=out.read_text()
            self.assertIn('id="reference"',html)
            self.assertIn('width:100%;height:auto;max-width:512px;aspect-ratio:256/224',html)
            self.assertIn('id="js"',html)
            self.assertIn('id="difference"',html)
            self.assertIn('id="diagnostics"',html)
            self.assertIn("Offset JS óptimo en ±2 px",html)
            self.assertIn("RGB de MAME ausente de la paleta capturada",html)
            self.assertIn("Los offsets y la distribución son hipótesis diagnósticas",html)
            self.assertIn('256',html)
            self.assertIn('224',html)
            self.assertIn("MAME ejecutando el juego original",html)
            self.assertIn("function renderGngbRgba",html)
            self.assertIn("const frame=renderGngbRgba({",html)
            self.assertNotIn("__FRAME_RENDERER_MODULE__",html)
            self.assertIn("const originalRAM=new Uint8Array(65536)",html)
            self.assertIn('originalRAM.set(arrays.foreground,0x2000)',html)
            self.assertIn('originalRAM.set(arrays.background,0x2800)',html)
            self.assertIn('0x80+t.palette*4+pen',html)
            self.assertIn("bit<<(3-plane)",html)
            self.assertIn("offset+0x10000*8)<<2",html)
            self.assertNotIn("__ROM_AND_RAM__",html)
            self.assertNotIn("__REFERENCE_B64__",html)
            self.assertEqual(report["source_frame"],600)
            scripts=re.findall(r"<script>(.*?)</script>",html,re.S)
            self.assertEqual(len(scripts),1)
            if shutil.which("node"):
                script=folder/"render.mjs"
                script.write_text(scripts[0])
                result=subprocess.run(["node","--check",str(script)],
                    capture_output=True,text=True,timeout=15)
                self.assertEqual(result.returncode,0,result.stderr)

    def test_modified_ref_memory_bytes_never_silently_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            ref=folder/"ref"
            reference_fixture(ref)
            (ref/"foreground.bin").write_bytes(bytes(0x800))
            with self.assertRaisesRegex(ValueError,"digest mismatch"):
                frames.read_reference(ref)

    def test_missing_dma_evidence_never_accepted_in_view(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            ref=folder/"ref"
            reference_fixture(ref)
            m=json.loads((ref/"manifest.json").read_text())
            m["sprite_dma_observed"]=False
            (ref/"manifest.json").write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,"DMA"):
                frames.read_reference(ref)


if __name__=="__main__":
    unittest.main()
