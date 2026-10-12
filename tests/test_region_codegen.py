"""Synthetic P-code region tests; never substitute these for real-ROM equivalence."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from function_ir import normalize_function
from pcode_codegen import Unsupported
from region_codegen import region_before_sync, compile_region, build


def fixture():
    return normalize_function({
        'entry': '0x7000', 'name': 'test', 'bank_context': 'bank4',
        'instructions': [
            {'address': '0x7000', 'raw': '12', 'length': 1, 'assembly': 'NOP',
             'flows': [], 'fallthrough': '0x7001', 'flow_type': 'FALL_THROUGH',
             'pcode': [{'op': 'COPY',
                        'output': {'space': 'register','offset': '0x0','size': 1},
                        'inputs': [{'space': 'const','offset': '0x7','size': 1}]}],
             'pcode_status': 'native'},
            {'address': '0x7001', 'raw': '13', 'length': 1, 'assembly': 'SYNC',
             'flows': [], 'fallthrough': '0x7002', 'flow_type': 'FALL_THROUGH',
             'pcode': [], 'pcode_status': 'unmodeled-wait-for-interrupt'},
            {'address': '0x7002', 'raw': '12', 'length': 1, 'assembly': 'NOP',
             'flows': [], 'fallthrough': None, 'flow_type': 'TERMINATOR',
             'pcode': [], 'pcode_status': 'verified-nop'},
        ]})


class RegionTests(unittest.TestCase):
    def test_segment_generation(self):
        region = region_before_sync(fixture(), 0x7001)
        self.assertEqual(region['instruction_count'], 1)
        js = compile_region(region)
        self.assertIn('suspended-before-SYNC', js)
        self.assertNotIn('case 28673', js)

    def test_verified_sync_required(self):
        with self.assertRaisesRegex(Unsupported, 'ROM-verified SYNC'):
            region_before_sync(fixture(), 0x7000)

    def test_unknown_path_blocked(self):
        f = fixture()
        f['blocks'][0]['instructions'][0]['fallthrough'] = 0x7800
        with self.assertRaisesRegex(Unsupported, 'Unknown path'):
            region_before_sync(f, 0x7001)

    def test_truncated_blocked(self):
        f = fixture()
        f['truncated'] = True
        with self.assertRaisesRegex(Unsupported, 'truncated'):
            region_before_sync(f, 0x7001)

    def test_build_report(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as d:
            report = build({'schema': 'gng.function-ir-bundle.v1', 'functions': [fixture()]},
                           Path(d), 0x7000, 0x7001)
            self.assertEqual(report['status'], 'generated-not-equivalence-verified')
            self.assertTrue((Path(d) / 'boot-prefix.ts').is_file())


if __name__ == '__main__':
    unittest.main()
