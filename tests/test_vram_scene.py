"""V1.2 produces genuine-ROM graphics in an offline two-state tilemap viewer.

Fixtures emulate neither 6809 code nor game physics. All synthetic bytes
are clearly labeled and original private ROM material stays in out/.
"""
from __future__ import annotations

import base64
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import graphics_preview
import vram_scene
from test_graphics_preview import fixture_zips


class VramSceneTests(unittest.TestCase):
    def test_character_two_planes_and_tile_three_planes(self):
        chars=bytearray(0x4000)
        chars[0]=0x88
        chars[1]=0x88
        self.assertEqual(vram_scene._pen(bytes(chars),"fg",0,0,0),3)
        self.assertEqual(vram_scene._pen(bytes(chars),"fg",0,4,0),3)
        self.assertEqual(vram_scene._pen(bytes(chars),"fg",0,1,0),0)

        tiles=bytearray(0x18000)
        tiles[0]=0x80
        tiles[0x8000]=0x80
        tiles[0x10000]=0x80
        tiles[16]=0x80
        self.assertEqual(vram_scene._pen(bytes(tiles),"bg",0,0,0),7)
        self.assertEqual(vram_scene._pen(bytes(tiles),"bg",0,8,0),4)
        self.assertEqual(vram_scene._pen(bytes(tiles),"bg",0,1,0),0)
        with self.assertRaisesRegex(ValueError,"Unknown"):
            vram_scene._pen(bytes(tiles),"unknown",0,0,0)

    def test_fixture_picks_only_indices_from_actual_region(self):
        rom=bytes([0x55,0xaa])*0xc000
        indices=vram_scene.choose_tiles(rom,"bg",14)
        self.assertEqual(len(indices),14)
        self.assertEqual(len(set(indices)),14)
        self.assertTrue(all(0<=i<1024 for i in indices))
        self.assertGreaterEqual(min(abs(a-b) for a,b in zip(indices,indices[1:])),1)
        chars=bytes([0x5a])*0x4000
        self.assertEqual(len(vram_scene.choose_tiles(chars,"fg",14)),14)
        with self.assertRaisesRegex(ValueError,"Invalid original bg"):
            vram_scene.choose_tiles(bytes(5),"bg")

    def test_generation_offline_two_canvases_private_3_regions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            main,parent,parts,data=fixture_zips(root)
            output=root/"out/visual/vram-scene.html"
            with patch.object(graphics_preview,"PARTS",parts):
                result=vram_scene.build(main,output,parent)
            self.assertEqual(result["schema"],"gng.vram-scene.v1")
            self.assertEqual(result["status"],"VRAM_FIXTURE_NOT_GAME_FRAME")
            self.assertTrue(result["source_bytes_from_game_rom"])
            self.assertFalse(result["memory_fixture_generated_by_game"])
            self.assertFalse(result["real_hardware_palette"])
            self.assertFalse(result["gameplay"])
            self.assertFalse(result["game_frame"])
            self.assertEqual(result["layers"],
                ["BG_BACK","SPRITES","BG_FRONT","FG_OPTIONAL"])
            self.assertEqual(len(result["selected_rom_graphic_indices"]["bg"]),14)
            self.assertEqual(len(result["selected_rom_graphic_indices"]["fg"]),14)
            self.assertEqual(len(result["selected_rom_graphic_indices"]["sprites"]),5)
            html=output.read_text()
            self.assertIn('id="before"',html)
            self.assertIn('id="after"',html)
            self.assertIn("ESCENA DIAGNÓSTICA, NO UNA PANTALLA DEL JUEGO",html)
            self.assertIn('a.download="v1.2-"+label+".png"',html)
            self.assertIn('save($("before"),"before")',html)
            self.assertIn('save($("after"),"after")',html)
            self.assertIn("bgPixelLayer(",html)
            self.assertIn("screenTile(",html)
            self.assertIn("spriteMemoryChange()",html)
            self.assertIn("changedTileBytes(",html)
            self.assertIn("writeFixtureTile(",html)
            self.assertIn("scrollRegState(",html)
            self.assertNotIn("__VIDEO_MODULE__",html)
            self.assertNotIn("__SPRITE_MODULE__",html)
            self.assertNotIn("__ROM_JSON__",html)
            match=re.search(r"const encoded=(\{.*?\});",html)
            self.assertIsNotNone(match)
            regions=json.loads(match.group(1))
            self.assertEqual(base64.b64decode(regions["chars"]),data["gg1.bin"])
            self.assertEqual(len(base64.b64decode(regions["tiles"])),0x18000)
            self.assertEqual(len(base64.b64decode(regions["sprites"])),0x20000)
            self.assertEqual(base64.b64decode(regions["tiles"])[:0x4000],
                             data["gg11.bin"])
            self.assertEqual(base64.b64decode(regions["sprites"])[0x18000:0x1c000],
                             data["gg12.bin"])
            if shutil.which("node"):
                scripts=re.findall(r"<script>(.*?)</script>",html,re.S)
                self.assertEqual(len(scripts),1)
                tmp_js=output.parent/"check-built-scene.mjs"
                tmp_js.write_text(scripts[0])
                check=subprocess.run(["node","--check",str(tmp_js)],
                                     capture_output=True,text=True,timeout=15)
                self.assertEqual(check.returncode,0,check.stderr)
            report=json.loads((output.parent/"vram-scene.report.json").read_text())
            self.assertEqual(report["sha256"],result["sha256"])

    def test_missing_shared_gfx_blocks_private_html_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            main,parent,parts,data=fixture_zips(Path(tmp))
            with patch.object(graphics_preview,"PARTS",parts):
                with self.assertRaisesRegex(ValueError,"--shared"):
                    vram_scene.build(main,Path(tmp)/"visual.html")


if __name__=="__main__":
    unittest.main()
