import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src'))
from poc import START, END, lift_reset_loop, structure, generate_js, read_rom

# Synthetic opcode fixture: tests work in CI without redistributing a copyrighted ROM.
# 6809 instruction forms are the same; the operand values are deliberately different.
FIXTURE = bytes.fromhex('8e1e20108e0002cc1234ed81ed81313f26f8')

class TestLifter(unittest.TestCase):
    def image(self):
        data = bytearray(65536)
        data[START:END] = FIXTURE
        return bytes(data)

    def test_synthetic_translation(self):
        sir = structure(lift_reset_loop(self.image()))
        self.assertEqual(sir['start'], 0x1e20)
        self.assertEqual(sir['iterations'], 2)
        self.assertEqual(sir['word'], 0x1234)
        self.assertEqual(sir['stride_bytes'], 4)
        self.assertIn('memory[x++] = d >>> 8', generate_js(sir))
        self.assertIn('memory: Uint8Array', generate_js(sir, typescript=True))

    def test_unsupported_opcode_fails_closed(self):
        img = bytearray(self.image()); img[START] = 0x12
        with self.assertRaisesRegex(ValueError, 'Unsupported opcode'):
            lift_reset_loop(bytes(img))

    def test_control_flow_fails_closed(self):
        img = bytearray(self.image()); img[END-1] = 0
        with self.assertRaisesRegex(ValueError, 'branch target'):
            structure(lift_reset_loop(bytes(img)))

    def test_range_fails_closed(self):
        img = bytearray(self.image()); img[START+2] = 0xf0  # base becomes 0x1ef0, overflows sprite RAM with count set to 0x90
        img[START+6] = 0x90
        with self.assertRaisesRegex(ValueError, 'not within sprite RAM'):
            structure(lift_reset_loop(bytes(img)))

if __name__ == '__main__': unittest.main()

from verify_ghidra import verify
class TestGhidraCrossCheck(unittest.TestCase):
    def test_missing_pcode_fails(self):
        lir = lift_reset_loop(TestLifter().image())
        pcode = {'schema': 'gng.ghidra-pcode.v1', 'processor': '6809:BE:16:default',
                 'instructions': [dict(address=i['address'], raw=i['raw'], pcode=[]) for i in lir['instructions']]}
        with self.assertRaisesRegex(ValueError, 'Missing P-code'):
            verify(lir, pcode)
