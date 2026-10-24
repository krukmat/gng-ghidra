"""ROM-free tests of smoke result classification without private ROM."""
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import a063_smoke_signature_gate as gate

class SmokeSummaryTests(unittest.TestCase):
    def sample(self):
        return {'sampled_frame_bank_entries': {'0':1, '1':1, '2':0,'3':0,'4':0},
                'sampled_control_writes_before_handler':1}

    def test_256_authentic_pairs_and_transition_remain_checkpoint_only(self):
        result=gate.summarize([0]*128+[1]*128,self.sample())
        self.assertEqual(result['status'],
            'AUTHENTIC_ROM_PAIR_MATCHES_NEEDS_INSTRUCTION_BOUNDARY_ORACLE')
        self.assertFalse(result['native_bank_provenance_certified'])
        self.assertFalse(result['bank_identity_per_instruction_independently_verified'])
        self.assertFalse(result['frame_samples_independently_instruction_correlated'])

    def test_one_bank_is_inconclusive(self):
        result=gate.summarize([0]*300,self.sample())
        self.assertEqual(result['status'],'INCONCLUSIVE_NO_AUTHENTICATED_TRANSITION')

    def test_too_short_smoke_is_inconclusive(self):
        result=gate.summarize([0,1],self.sample())
        self.assertEqual(result['status'],'INCONCLUSIVE_FEWER_THAN_256_PRESTATES')

    def test_frame_mismatch_never_promoted(self):
        samples=self.sample();samples['sampled_frame_bank_entries']={'3':2}
        result=gate.summarize([0]*128+[1]*128,samples)
        self.assertEqual(result['status'],'INCONCLUSIVE_FRAME_BANK_NOT_OBSERVED_IN_TRACE')

    def test_invalid_entries_rejected(self):
        for entries in ([5],[True],[],[0,300]):
            with self.subTest(entries=entries),self.assertRaises(ValueError):
                gate.summarize(entries,self.sample())

if __name__ == '__main__':unittest.main()
