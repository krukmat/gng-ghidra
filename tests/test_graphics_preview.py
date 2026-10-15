"""ROM-free tests for the first visible artifact. Never store game ROM data."""
import base64
import json
import re
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import graphics_preview as graphics


def fixture_zips(folder):
    names = list(graphics.PARTS)
    data = {name: bytes([(i * 23 + 7) & 255]) * graphics.PARTS[name][0]
            for i, name in enumerate(names)}
    patched_parts = {
        name: (length, zlib.crc32(data[name]), region, offset)
        for name, (length, _, region, offset) in graphics.PARTS.items()
    }
    primary = folder / "gngb.zip"
    shared = folder / "parent.zip"
    with zipfile.ZipFile(primary, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name in names[:4]:
            z.writestr(name, data[name])
    with zipfile.ZipFile(shared, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name in names[4:]:
            z.writestr("roms/" + name, data[name])
    return primary, shared, patched_parts, data


class GraphicsPreviewTests(unittest.TestCase):
    def test_actual_mame_gngb_graphics_layout_and_parts_are_pinned(self):
        self.assertEqual(len(graphics.PARTS), 13)
        self.assertEqual(graphics.PARTS["gg1.bin"][1], 0xecfccf07)
        self.assertEqual(graphics.PARTS["gg11.bin"][1], 0xddd56fa9)
        self.assertEqual(graphics.PARTS["gg12.bin"][1], 0x7780a925)
        self.assertEqual(graphics.SIZES["sprites"], 0x20000)
        self.assertEqual(graphics.SIZES["tiles"], 0x18000)

    def test_split_parent_assets_are_merged_and_hole_keeps_erased_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            primary, shared, changed, data = fixture_zips(root)
            with patch.object(graphics, "PARTS", changed):
                merged, hashes = graphics.load_regions([primary, shared])
            self.assertEqual(len(hashes), 13)
            self.assertEqual(merged["chars"], data["gg1.bin"])
            self.assertEqual(len(merged["tiles"]), 0x18000)
            self.assertEqual(merged["tiles"][:0x4000], data["gg11.bin"])
            self.assertEqual(merged["tiles"][0x14000:], data["gg6.bin"])
            self.assertEqual(merged["sprites"][0xc000:0x10000], b"\xff" * 0x4000)
            self.assertEqual(merged["sprites"][0x10000:0x14000], data["gg14.bin"])

    def test_missing_parent_zip_fails_with_helpful_message(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            primary, _, changed, _ = fixture_zips(root)
            with patch.object(graphics, "PARTS", changed):
                with self.assertRaisesRegex(ValueError, r"Missing gg.*--shared"):
                    graphics.load_regions([primary])

    def test_wrong_crc_and_conflicts_never_generate_untrusted_pixels(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            primary, shared, changed, data = fixture_zips(root)
            with self.assertRaisesRegex(ValueError, "wrong size/CRC"):
                graphics.load_regions([primary, shared])
            dup = root / "conflict.zip"
            with zipfile.ZipFile(dup, "w") as z:
                z.writestr("gg1.bin", bytes([0x57]) * 0x4000)
            with patch.object(graphics, "PARTS", changed):
                with self.assertRaisesRegex(ValueError, "wrong size/CRC"):
                    graphics.load_regions([primary, shared, dup])

    def test_html_is_self_contained_and_never_claims_gameplay(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            primary, shared, changed, data = fixture_zips(root)
            outfile = root / "out" / "graphics-preview.html"
            with patch.object(graphics, "PARTS", changed):
                report = graphics.build(primary, outfile, shared)
            self.assertEqual(report["schema"], "gng.visible-rom-graphics.v1")
            self.assertEqual(report["status"], "VISUAL_ASSET_INSPECTOR_ONLY")
            self.assertFalse(report["playable"])
            self.assertFalse(report["rendered_from_live_cpu_ram"])
            self.assertFalse(report["actual_arcade_palette"])
            self.assertEqual(report["graphics"]["sprites"]["count"], 1024)
            self.assertTrue(outfile.exists())
            html = outfile.read_text()
            self.assertIn("<canvas", html)
            self.assertIn('value="sprites"', html)
            self.assertNotIn("__PAYLOAD__", html)
            self.assertIn("No hay CPU", html)
            match = re.search(r"const B64=(\{.*?\});", html)
            self.assertIsNotNone(match, "Embedded graphics payload missing")
            decoded = json.loads(match.group(1))
            self.assertEqual(base64.b64decode(decoded["chars"]), data["gg1.bin"])
            self.assertEqual(len(base64.b64decode(decoded["sprites"])), 0x20000)
            manifest = json.loads((outfile.parent / "graphics-preview.manifest.json").read_text())
            self.assertEqual(manifest["viewer_sha256"], report["viewer_sha256"])

    def test_zip_with_duplicate_basename_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            primary = root / "duplicate.zip"
            with zipfile.ZipFile(primary, "w") as z:
                z.writestr("gg1.bin", bytes(0x4000))
                z.writestr("other/gg1.bin", bytes(0x4000))
            with self.assertRaisesRegex(ValueError, "ambiguous duplicate"):
                graphics.load_regions([primary])


if __name__ == "__main__":
    unittest.main()
