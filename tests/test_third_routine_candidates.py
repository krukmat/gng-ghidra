"""ROM-free verification of the third-candidate triage; no fake eligibility."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
sys.path.insert(0,str(Path(__file__).resolve().parent))

from test_board_codegen import synthetic_image_and_raw, raw_routine, vn
from third_routine_candidates import rank, assess, SCHEMA
from function_inventory import rom_vectors


def add_candidate(raw,image,entry,pc_ops):
    data=bytearray(image)
    inst=raw_routine(entry,pc_ops)
    raw=dict(raw)
    raw['functions']=[*raw['functions'],inst]
    for i in inst['instructions']:
        data[int(i['address'],16)]=0x39
    raw['vectors']=rom_vectors(bytes(data))
    return raw,bytes(data)



def modeled_rts_ops():
    """Synthetic P-code models an actual 6809 RTS: 2-byte S pop and RETURN."""
    return [
        {'op':'LOAD','space_name':'RAM','output':vn('unique',0x200,2),
         'inputs':[vn('const',1,8),vn('register',24,2)]},
        {'op':'INT_ADD','inputs':[vn('register',24,2),vn('const',2,2)],
         'output':vn('register',24,2)},
        {'op':'RETURN','output':None,'inputs':[vn('unique',0x200,2)]},
    ]


class ThirdRoutineRankingTests(unittest.TestCase):
    def test_real_previous_two_not_represented_as_third(self):
        raw,image=synthetic_image_and_raw()
        report=rank(raw,image)
        self.assertEqual(report['schema'],SCHEMA)
        by_entry={r['entry']:r for r in report['candidates']}
        self.assertEqual(by_entry['0x622c']['status'],'ALREADY_TESTED')
        self.assertEqual(by_entry['0x6755']['status'],'ALREADY_TESTED')
        for e in ['0x6000','0x65c4']:
            self.assertEqual(by_entry[e]['status'],'EXCLUDED_ROOT')
        self.assertFalse(any(x['native_6809_equivalence_verified']
                             for x in report['candidates']))

    def test_rom_byte_mismatch_rejected_before_ranking(self):
        raw,image=synthetic_image_and_raw()
        corrupt=bytearray(image)
        corrupt[0x622c]=0x12
        with self.assertRaisesRegex(ValueError,'ROM bytes differ'):
            rank(raw,bytes(corrupt))

    def test_index_X_remains_unverified_even_when_pcode_compiles(self):
        raw,image=synthetic_image_and_raw()
        load={'op':'LOAD','space_name':'RAM','output':vn('register',0,1),
              'inputs':[vn('const',1,8),vn('register',18,2)]}
        raw,image=add_candidate(raw,image,0x7930,[
            (0x7930,[load]),(0x7931,modeled_rts_ops())])
        report=rank(raw,image)
        candidate=next(x for x in report['candidates']
                       if x['entry']=='0x7930')
        self.assertEqual(candidate['status'],'NEEDS_REGISTER_BOUNDS')
        self.assertTrue(candidate['structural_compile_possible'])
        self.assertEqual(candidate['unresolved_pointer_count'],1)
        self.assertGreaterEqual(candidate['index_dependent_accesses'],1)
        self.assertFalse(candidate['conditional_pure_eligibility_proven'])

    def test_short_small_ram_only_candidate_can_be_prioritized(self):
        raw,image=synthetic_image_and_raw()
        direct={'op':'COPY','inputs':[vn('RAM',0x40,1)],
                'output':vn('register',0,1)}
        raw,image=add_candidate(raw,image,0x7930,[
            (0x7930,[direct]),(0x7931,modeled_rts_ops())])
        report=rank(raw,image)
        selected=report['candidates'][0]
        self.assertEqual(selected['entry'],'0x7930')
        self.assertEqual(selected['status'],'POTENTIAL_CONDITIONAL_PURE_LEAF')
        self.assertEqual(selected['conditionally_in_ram_or_rom'],2)
        self.assertEqual(selected['memory_total'],2)
        self.assertFalse(selected['conditional_pure_eligibility_proven'])
        self.assertFalse(selected['game_reachability_proven'])

    def test_forged_return_without_stack_pop_stays_structurally_blocked(self):
        raw,image=synthetic_image_and_raw()
        raw,image=add_candidate(raw,image,0x7930,[
            (0x7930,[{'op':'COPY','inputs':[vn('RAM',0x40,1)],
                      'output':vn('register',0,1)}]),
            (0x7931,[{'op':'RETURN','inputs':[vn('register',24,2)],
                      'output':None}]),
        ])
        item=next(x for x in rank(raw,image)['candidates']
                  if x['entry']=='0x7930')
        self.assertEqual(item['status'],'STRUCTURAL_BLOCK')
        self.assertFalse(item['modeled_6809_rts_stack_pop'])
        self.assertIn('no validated RTS P-code pop from S',item['blockers'])

    def test_shared_exported_instruction_blocks_independent_boundary(self):
        raw,image=synthetic_image_and_raw()
        direct={'op':'COPY','inputs':[vn('RAM',0x40,1)],
                'output':vn('register',0,1)}
        raw,image=add_candidate(raw,image,0x7930,[
            (0x7930,[direct]),(0x7931,modeled_rts_ops())])
        raw,image=add_candidate(raw,image,0x7931,[
            (0x7931,modeled_rts_ops())])
        by_entry={x['entry']:x for x in rank(raw,image)['candidates']}
        for address in ('0x7930','0x7931'):
            item=by_entry[address]
            self.assertEqual(item['status'],'STRUCTURAL_BLOCK')
            self.assertEqual(item['overlapping_exported_instruction_count'],1)
            self.assertTrue(any('overlapping exported Ghidra CFG' in x
                                for x in item['blockers']))

    def test_unproven_manual_seed_not_claimed_as_incoming_call(self):
        raw,image=synthetic_image_and_raw()
        raw,image=add_candidate(raw,image,0x7930,[
            (0x7930,[{'op':'COPY','inputs':[vn('RAM',0x40,1)],
                      'output':vn('register',0,1)}]),
            (0x7931,modeled_rts_ops())])
        item=next(x for x in rank(raw,image)['candidates']
                  if x['entry']=='0x7930')
        self.assertFalse(item['decoded_incoming_call_provenance'])
        self.assertFalse(item['game_reachability_proven'])

    def test_unknown_io_and_mmio_store_are_separate_from_index_bounds(self):
        raw,image=synthetic_image_and_raw()
        direct_write={'op':'COPY','inputs':[vn('register',0,1)],
                      'output':vn('RAM',0x3b10,1)}
        raw,image=add_candidate(raw,image,0x7930,[
            (0x7930,[direct_write]),(0x7931,modeled_rts_ops())])
        item=next(x for x in rank(raw,image)['candidates']
                  if x['entry']=='0x7930')
        self.assertEqual(item['status'],'NEEDS_BOARD_CONTRACT')
        self.assertEqual(item['mmio_access_count'],1)
        self.assertEqual(item['unresolved_pointer_count'],0)
        self.assertEqual(item['mmio_sites'][0]['address_interval'],
                         [0x3b10,0x3b10])
        self.assertFalse(item['native_6809_equivalence_verified'])


if __name__=='__main__':
    unittest.main()
