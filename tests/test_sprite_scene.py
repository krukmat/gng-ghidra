"""V1.1: ROM-free generation tests; do not publish game graphics."""
from __future__ import annotations
import base64
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import graphics_preview
import sprite_scene
from test_graphics_preview import fixture_zips

class SpriteSceneTests(unittest.TestCase):
    def test_bitplane_layout_matches_encoded_bit_numbering(self):
        rom=bytearray(0x20000)
        rom[0]=0x88
        rom[0x10000]=0x88
        self.assertEqual(sprite_scene.pen(bytes(rom),0,0,0),15)
        self.assertEqual(sprite_scene.pen(bytes(rom),0,4,0),0)
        rom[64]=0x80
        self.assertEqual(sprite_scene.pen(bytes(rom),1,0,0),8)
        self.assertEqual(sprite_scene.pen(bytes(rom),1,15,15),0)

    def test_offline_scene_from_locally_validated_fixture_zips(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            main,parent,parts,data=fixture_zips(root)
            dst=root/'out/visual/vram-sprites.html'
            with patch.object(graphics_preview,'PARTS',parts):
                report=sprite_scene.build(main,dst,parent)
            self.assertEqual(report['status'],'VRAM_FIXTURE_NOT_REAL_GAME_FRAME')
            self.assertFalse(report['gameplay'])
            self.assertFalse(report['cpu_original_logic_executed'])
            self.assertFalse(report['cpu_emulated'])
            self.assertEqual(len(report['initial_sprite_rom_indices']),3)
            self.assertTrue(report['sprite_dma_snapshot_explicit'])
            self.assertEqual(report['sprite_ram_range'],['0x1e00','0x2000'])
            self.assertTrue(dst.exists())
            content=dst.read_text()
            self.assertNotIn('__SPRITE_B64__',content)
            self.assertNotIn('__SPRITE_MODULE__',content)
            self.assertNotIn('__INITIAL_ASSETS__',content)
            self.assertIn('VRAM FIXTURE — NO GAMEPLAY',content)
            self.assertIn('writeSprite(memory,slot,bytes)',content)
            self.assertIn('readSpritePen(rom,index,x,y)',content)
            self.assertIn('id="before"',content)
            self.assertIn('id="after"',content)
            self.assertIn('v1.1-before.png',content)
            self.assertIn('v1.1-after.png',content)
            match=re.search(r'const imageBytes=atob\\((".*?")\\);',content)
            self.assertIsNotNone(match)
            encoded=json.loads(match.group(1))
            self.assertEqual(len(base64.b64decode(encoded)),0x20000)
            self.assertEqual(base64.b64decode(encoded)[0x18000:0x1c000],
                             data['gg12.bin'])
            saved=json.loads((dst.parent/'vram-sprites.report.json').read_text())
            self.assertEqual(saved['sha256'],report['sha256'])

    def test_missing_shared_rom_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            main,parent,parts,data=fixture_zips(Path(tmp))
            with patch.object(graphics_preview,'PARTS',parts):
                with self.assertRaisesRegex(ValueError,'--shared'):
                    sprite_scene.build(main,Path(tmp)/'vram.html')

    def test_reject_out_of_range_sprite_region(self):
        with self.assertRaisesRegex(ValueError,'0x20000-byte'):
            sprite_scene.pick_sprites(bytes(0x4000))

if __name__=='__main__':
    unittest.main()
