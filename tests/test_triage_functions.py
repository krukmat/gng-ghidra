"""Pure report rendering: all candidates, not only shortlist."""
import importlib.util
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'triage-functions.py'
SPEC = importlib.util.spec_from_file_location('t2b_triage', PATH)
triage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(triage)


class TriageTests(unittest.TestCase):
    def test_shows_all_candidates_with_compiler_and_reachability(self):
        inv = {
            'schema':'gng.function-inventory.v1',
            'exported_function_count':14,
            'ghidra_confirmed_anchored_calls':[{'call_site':'0x65d3'}],
            'candidates':[
                {'entry':'0x6755','classification':'requires-review',
                 'discovery':'exported','review_blockers':['MMIO'],
                 'evidence_caveats':['anchored-call-reachability-unverified'],
                 'metrics':{'instruction_count':8,'return_count':1},
                 'provenance':[{'type':'ghidra-confirmed-anchored-jsr'}]},
                {'entry':'0x6274','classification':'eligible-for-codegen-review',
                 'discovery':'exported','review_blockers':[], 'evidence_caveats':[],
                 'metrics':{'instruction_count':5,'return_count':1},
                 'provenance':[{'type':'ghidra-direct-call'}]},
            ],
        }
        lines = triage.render(inv, {'blocked':[{
            'entry':'0x6755','reason':'MMIO unsupported'
        }]})
        self.assertIn('exported=14', lines[0])
        self.assertIn('eligible_for_codegen_review=1', lines[0])
        self.assertEqual(len([line for line in lines if line.startswith('  0x')]), 2)
        self.assertIn('compiler=MMIO unsupported', lines[1])
        self.assertIn('caveats=anchored-call-reachability-unverified', lines[1])
        self.assertIn('NOT_ESTABLISHED', lines[-1])

    def test_bad_schema_rejected(self):
        with self.assertRaisesRegex(ValueError, 'ROM-authenticated'):
            triage.render({'schema':'anything','candidates':[]})


if __name__ == '__main__':
    unittest.main()
