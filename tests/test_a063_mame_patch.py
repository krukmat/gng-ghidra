"""ROM-free synthetic MAME 0.289 driver patch check."""
from __future__ import annotations
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PATCH=ROOT/"patches/mame0289-a063-bank-oracle.patch"

class PatchTests(unittest.TestCase):
    def test_patch_applies_to_expected_0289_source_shapes(self):
        if not shutil.which("git"):
            self.skipTest("git unavailable")
        with tempfile.TemporaryDirectory() as d:
            file=Path(d)/"src/mame/capcom/gng.cpp"
            file.parent.mkdir(parents=True)
            lines=["// synthetic fixture\n"]*700
            lines[34:39]=['#include "emu.h"\n',"\n",
                          '#include "cpu/m6809/m6809.h"\n',
                          '#include "cpu/z80/z80.h"\n',
                          '#include "machine/74259.h"\n']
            lines[540:546]=[
                "\tm_mainbank->configure_entries(0, 4, &rombase[0x10000], 0x2000);\n",
                "\tm_mainbank->configure_entry(4, &rombase[0x4000]);\n",
                "\n","\tsave_item(NAME(m_scrollx));\n",
                "\tsave_item(NAME(m_scrolly));\n","}\n"]
            file.write_text("".join(lines))
            subprocess.run(["git","-C",d,"apply","--check",str(PATCH)],
                           check=True,capture_output=True,text=True)
            subprocess.run(["git","-C",d,"apply",str(PATCH)],
                           check=True,capture_output=True,text=True)
            patched=file.read_text()
            self.assertEqual(patched.count("gng_a063_bank"),1)
            self.assertIn("m_mainbank->entry()",patched)
            self.assertIn("debug/debugcpu.h",patched)
            with self.assertRaises(subprocess.CalledProcessError):
                subprocess.run(["git","-C",d,"apply","--check",str(PATCH)],
                               check=True,capture_output=True,text=True)

    def test_patch_does_not_rewrite_bank_switch_handler(self):
        text=PATCH.read_text()
        self.assertNotIn("bankswitch_w(",text)
        self.assertNotIn(".bankr(",text)
        self.assertNotIn("set_entry(",text)
        self.assertIn("gng_a063_bank",text)

if __name__=="__main__":
    unittest.main()
