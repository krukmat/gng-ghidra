"""ROM-free regression tests for content-based MAME set detection.

This reproduces the operator's exact failure mode: a file named gng.zip
containing the GG4/GG3/GG5 program revision actually required by gngb.
No proprietary chip bytes are present in these fixtures.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
from pathlib import Path
from unittest.mock import patch
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location(
    "prepare_mame_rom",ROOT/"scripts/prepare_mame_rom.py")
prep=importlib.util.module_from_spec(spec)
sys.modules["prepare_mame_rom"]=prep
spec.loader.exec_module(prep)


def fake_data(machine="gngb",missing=None):
    names = ("gg4.bin","gg3.bin","gg5.bin") if machine=="gngb" else (
        "mm_c_04","mm_c_03","mm_c_05")
    payload = {name: bytes([i+1])*512 for i,name in enumerate(names)}
    payload.update({
        "gg1.bin": b"\x9a"*256,
        "gg11.bin": b"\x9b"*256,
        "gg2.bin": b"\x9c"*512,
        "tbp24s10.14k": b"\x9d"*64,
        "63s141.2e": b"\x9e"*64,
        "gg-pal10l8.bin": b"\x9f"*44,
    })
    for key in missing or []:
        payload.pop(key)
    return payload


def specmap(payload,names):
    return {name:(len(payload[name]),zlib.crc32(payload[name]))
            for name in names if name in payload}


class PrepareMameRomTests(unittest.TestCase):
    def setup_fakes(self,data,source):
        fake_core={}
        for machine in prep.CORE:
            files=("gg4.bin","gg3.bin","gg5.bin") if machine=="gngb" else (
                "mm_c_04","mm_c_03","mm_c_05")
            fake_core[machine]={name:(len(data[name]),zlib.crc32(data[name]))
                if name in data else (0x4000+i,0x99+i)
                for i,name in enumerate(files)}
        gfx={"gg1.bin":(256,zlib.crc32(b"\x9a"*256),"chars",0),
             "gg11.bin":(256,zlib.crc32(b"\x9b"*256),"tiles",0)}
        aux={name:(size,zlib.crc32(value))
             for name,size,value in [
             ("gg2.bin",512,b"\x9c"*512),
             ("tbp24s10.14k",64,b"\x9d"*64),
             ("63s141.2e",64,b"\x9e"*64),
             ("gg-pal10l8.bin",44,b"\x9f"*44)]}
        z=zipfile.ZipFile(source,"w",compression=zipfile.ZIP_DEFLATED)
        with z:
            for key,value in data.items():
                z.writestr(key,value)
        return patch.object(prep,"CORE",fake_core),patch.object(
            prep,"GRAPHICS",gfx),patch.object(prep,"AUXILIARY",aux)

    def test_misnamed_gng_zip_is_detected_as_gngb_by_chip_crc(self):
        data=fake_data("gngb")
        (ROOT/"out").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/"out") as temp:
            folder=Path(temp)
            source=folder/"gng.zip"
            a,b,c=self.setup_fakes(data,source)
            with a,b,c:
                report=prep.prepare(source,folder/"mame")
            self.assertEqual(report["machine"],"gngb")
            self.assertEqual(report["status"],"READY_FOR_NATIVE_MAME_CAPTURE")
            alias=folder/"mame/gngb.zip"
            self.assertTrue(alias.is_symlink())
            self.assertEqual(alias.resolve(),source.resolve())
            self.assertEqual(source.read_bytes(),alias.read_bytes())
            self.assertFalse((folder/"mame/gng.zip").exists())
            self.assertFalse((folder/"mame/gng.zip").is_symlink())
            saved=json.loads((folder/"mame/rom-set.json").read_text())
            self.assertEqual(saved["machine"],"gngb")

    def test_real_gng_program_names_select_real_gng_machine(self):
        data=fake_data("gng")
        (ROOT/"out").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/"out") as temp:
            folder=Path(temp)
            source=folder/"custom-file-name.zip"
            a,b,c=self.setup_fakes(data,source)
            with a,b,c:
                report=prep.prepare(source,folder/"mame")
            self.assertEqual(report["machine"],"gng")
            self.assertTrue((folder/"mame/gng.zip").is_symlink())

    def test_missing_audio_or_prom_is_reported_not_synthesized(self):
        data=fake_data("gngb",missing=["gg2.bin"])
        (ROOT/"out").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/"out") as temp:
            folder=Path(temp)
            source=folder/"gng.zip"
            a,b,c=self.setup_fakes(data,source)
            with a,b,c:
                report=prep.prepare(source,folder/"mame")
            self.assertEqual(report["machine"],"gngb")
            self.assertEqual(report["status"],"BLOCKED_MISSING_REQUIRED_CHIPS")
            self.assertEqual(report["missing_auxiliary"],["gg2.bin"])
            self.assertFalse((folder/"mame/gngb.zip").exists())

    def test_unknown_chip_program_crc_cannot_select_any_set(self):
        data=fake_data("gngb")
        data["gg4.bin"]=b"\xff"*512
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"gng.zip"
            a,b,c=self.setup_fakes(data,path)
            with a,b,c:
                # Corrupt contents *after* pinning fake expected CRC.
                data2=dict(data)
                data2["gg4.bin"]=bytes(512)
                with zipfile.ZipFile(path,"w") as z:
                    for key,val in data2.items():
                        z.writestr(key,val)
                with self.assertRaisesRegex(ValueError,"Cannot uniquely identify"):
                    prep.inspect_archive(path)

    def test_existing_non_symlink_alias_is_not_overwritten(self):
        data=fake_data("gngb")
        (ROOT/"out").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/"out") as temp:
            folder=Path(temp)
            source=folder/"gng.zip"
            alias=folder/"mame"
            alias.mkdir()
            marker=alias/"gngb.zip"
            marker.write_text("do not overwrite")
            a,b,c=self.setup_fakes(data,source)
            with a,b,c:
                with self.assertRaisesRegex(ValueError,"Refusing to overwrite"):
                    prep.prepare(source,alias)
            self.assertEqual(marker.read_text(),"do not overwrite")

    def test_reject_output_outside_ignored_directory(self):
        data=fake_data("gngb")
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp)
            source=folder/"gng.zip"
            a,b,c=self.setup_fakes(data,source)
            with a,b,c:
                with self.assertRaisesRegex(ValueError,"inside ignored out"):
                    prep.prepare(source,folder/"not-ignored")

    def test_wrapper_runs_content_preflight_and_has_no_filename_inference(self):
        wrapper=(ROOT/"scripts/visual-real-frame.sh").read_text()
        self.assertIn("prepare_mame_rom.py",wrapper)
        self.assertIn('"machine"',wrapper)
        self.assertIn("out/reference/mame-roms",wrapper)
        self.assertNotIn('system=gng\\n',wrapper)
        if shutil.which("bash"):
            parsed=subprocess.run(["bash","-n",str(ROOT/"scripts/visual-real-frame.sh")],
                                  capture_output=True,text=True)
            self.assertEqual(parsed.returncode,0,parsed.stderr)


if __name__=="__main__":
    unittest.main()
