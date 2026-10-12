"""ROM-free T2.B.6/7 vector/call discovery and shortlist regression tests."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from function_inventory import rom_vectors, inventory, verify_raw


def synthetic():
    image = bytearray(0x10000)
    for addr in range(0xfff2, 0x10000):
        image[addr] = 0xff
    image[0xfff8:0xfffa] = bytes.fromhex('65c4')
    image[0xfffe:0x10000] = bytes.fromhex('6000')
    image[0x6000:0x6004] = bytes.fromhex('bd700013')
    image[0x65c4] = 0x39
    image[0x7000] = 0x39
    reset = {'entry': '0x6000', 'bank_context': 'bank4', 'name': 'rom_6000',
             'truncated': False, 'instructions': [
                 {'address': '0x6000', 'raw': 'bd7000', 'length': 3,
                  'assembly': 'JSR 0x7000', 'flow_type': 'UNCONDITIONAL_CALL',
                  'flows': ['0x7000'], 'fallthrough': '0x6003',
                  'pcode_status': 'native', 'pcode': [
                      {'op': 'CALL', 'inputs': [{'space': 'RAM', 'offset': '0x7000', 'size': 2}]}]},
                 {'address': '0x6003', 'raw': '13', 'length': 1, 'assembly': 'SYNC',
                  'flow_type': 'FALL_THROUGH', 'flows': [], 'fallthrough': None,
                  'pcode_status': 'unmodeled-wait-for-interrupt', 'pcode': []}]}
    def leaf(entry):
        return {'entry': f'0x{entry:04x}', 'bank_context': 'bank4',
                'name': f'rom_{entry:04x}', 'instructions': [
                    {'address': f'0x{entry:04x}', 'raw': '39', 'length': 1,
                     'assembly': 'RTS', 'flow_type': 'TERMINATOR',
                     'flows': [], 'fallthrough': None, 'pcode_status': 'native',
                     'pcode': [{'op': 'RETURN', 'output': None,
                                'inputs': [{'space': 'register', 'offset': '0x1', 'size': 2}]}]}]}
    raw = {'schema': 'gng.ghidra-functions.v1', 'processor': '6809:BE:16:default',
           'bank_context': 'bank4', 'functions': [reset, leaf(0x65c4), leaf(0x7000)],
           'skipped': [], 'partial_discovery': False}
    raw['vectors'] = rom_vectors(bytes(image))
    return raw, bytes(image)


class DiscoveryTests(unittest.TestCase):
    def test_vector_addresses_are_big_endian_and_no_sentinel_seed(self):
        raw, image = synthetic()
        vs = rom_vectors(image)
        self.assertEqual([v['target'] for v in vs if v['status'] == 'mapped'],
                         ['0x65c4', '0x6000'])
        self.assertTrue(all(v['status'] == 'unmapped-or-sentinel'
                            for v in vs if v['name'] not in ('IRQ', 'RESET')))

    def test_inventory_uses_direct_call_and_separates_irq(self):
        raw, image = synthetic()
        inv, shortlist = inventory(raw, image)
        by_addr = {f['entry']: f for f in inv['candidates']}
        self.assertEqual(inv['exported_function_count'], 3)
        self.assertEqual(inv['decoded_direct_calls'][0]['target'], '0x7000')
        self.assertEqual(by_addr['0x7000']['classification'], 'eligible-for-codegen-review')
        self.assertEqual(by_addr['0x7000']['metrics']['return_count'], 1)
        self.assertIn('interrupt-entry: hardware context must be modeled',
                      by_addr['0x65c4']['review_blockers'])
        self.assertIn('reset-entry: not-an-independent-leaf-candidate',
                      by_addr['0x6000']['review_blockers'])
        self.assertEqual(shortlist['items'][0]['entry'], '0x7000')
        self.assertEqual(shortlist['eligible_for_codegen_review'], 1)
        self.assertFalse(shortlist['acceptance_met'])

    def test_missing_disassembly_still_inventoryable(self):
        raw, image = synthetic()
        raw['functions'] = [raw['functions'][0]]
        inv, shortlist = inventory(raw, image)
        by_addr = {f['entry']: f for f in inv['candidates']}
        self.assertEqual(by_addr['0x65c4']['discovery'], 'not-yet-exported')
        self.assertEqual(by_addr['0x7000']['discovery'], 'not-yet-exported')
        self.assertEqual(len(shortlist['items']), 2)

    def test_fails_closed_if_rom_and_export_bytes_differ(self):
        raw, image = synthetic()
        raw['functions'][0]['instructions'][0]['raw'] = 'bd7001'
        with self.assertRaisesRegex(ValueError, 'ROM bytes differ'):
            inventory(raw, image)

    def test_fails_closed_if_ghidra_vector_mismatch(self):
        raw, image = synthetic()
        raw['vectors'][3]['target'] = '0x7000'
        with self.assertRaisesRegex(ValueError, 'vector mismatch'):
            inventory(raw, image)

    def test_dynamic_memory_access_is_not_declared_safe(self):
        raw, image = synthetic()
        instr = raw['functions'][2]['instructions'][0]
        instr['pcode'].insert(0, {'op': 'STORE', 'space_name': 'RAM',
                                  'inputs': [
                                      {'space': 'const', 'offset': '0x1', 'size': 1},
                                      {'space': 'register', 'offset': '0x10', 'size': 2},
                                      {'space': 'const', 'offset': '0x1', 'size': 1}]})
        inv, _ = inventory(raw, image)
        candidate = next(x for x in inv['candidates'] if x['entry'] == '0x7000')
        self.assertIn('dynamic-memory-address: needs-MMIO-and-bank-proof',
                      candidate['review_blockers'])

    def test_independent_seed_without_vector_or_call_is_not_proven(self):
        raw, image = synthetic()
        raw['functions'][0]['instructions'][0]['flow_type'] = 'FALL_THROUGH'
        raw['functions'][0]['instructions'][0]['flows'] = []
        inv, _ = inventory(raw, image)
        candidate = next(x for x in inv['candidates'] if x['entry'] == '0x7000')
        self.assertIn('seed-has-no-vector-or-decoded-call-provenance',
                      candidate['review_blockers'])

    def test_wrong_schema_rejected(self):
        raw, image = synthetic()
        raw['processor'] = 'z80'
        with self.assertRaisesRegex(ValueError, 'CPU'):
            verify_raw(raw, image)


if __name__ == '__main__':
    unittest.main()

class SelectionSafetyTests(unittest.TestCase):
    def test_overlapping_graphs_are_not_called_independent(self):
        raw, image = synthetic()
        # Ghidra may export two seeds whose reachable CFGs overlap.
        orig = raw['functions'][2]
        second = copy.deepcopy(orig)
        second['entry'] = '0x7001'
        second['name'] = 'rom_7001'
        second['instructions'].insert(0, {'address': '0x7001', 'raw': '12',
            'length': 1, 'assembly': 'NOP', 'pcode_status': 'verified-nop',
            'pcode': [], 'flow_type': 'FALL_THROUGH', 'flows': [], 'fallthrough': '0x7000'})
        image = bytearray(image)
        image[0x7001] = 0x12
        raw['functions'].append(second)
        inv, _ = inventory(raw, bytes(image))
        candidate = next(c for c in inv['candidates'] if c['entry'] == '0x7000')
        self.assertIn('overlapping-exported-CFGs: independent-boundaries-unproven',
                      candidate['review_blockers'])

    def test_unsafe_static_store_rejected(self):
        raw, image = synthetic()
        raw['functions'][2]['instructions'][0]['pcode'].insert(0, {
            'op': 'STORE', 'space_name': 'RAM', 'inputs': [
                {'space': 'const', 'offset': '0x1', 'size': 1},
                {'space': 'const', 'offset': '0x3e00', 'size': 2},
                {'space': 'const', 'offset': '0x1', 'size': 1}]})
        inv, _ = inventory(raw, image)
        candidate = next(c for c in inv['candidates'] if c['entry'] == '0x7000')
        self.assertIn('static-memory-access-outside-safe-RAM', candidate['review_blockers'])

    def test_unknown_pcode_operator_is_not_eligible(self):
        raw, image = synthetic()
        raw['functions'][2]['instructions'][0]['pcode'].insert(0, {
            'op': 'INT_DIV', 'output': None, 'inputs': []})
        inv, _ = inventory(raw, image)
        candidate = next(c for c in inv['candidates'] if c['entry'] == '0x7000')
        self.assertIn('unsupported-P-code-operators', candidate['review_blockers'])

    def test_call_metadata_must_match_decoder(self):
        raw, image = synthetic()
        raw['functions'][0]['direct_calls'] = []
        with self.assertRaisesRegex(ValueError, 'call metadata mismatch'):
            inventory(raw, image)


class InventoryCliTests(unittest.TestCase):
    def test_cli_writes_both_reports_from_synthetic_export(self):
        raw, image = synthetic()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'image.bin').write_bytes(image)
            (root / 'functions.raw.json').write_text(json.dumps(raw))
            proc = subprocess.run([sys.executable,
                str(Path(__file__).resolve().parents[1] / 'src/function_inventory.py'),
                '--input', str(root / 'functions.raw.json'),
                '--rom-image', str(root / 'image.bin'),
                '--out', str(root / 'functions-inventory.json'),
                '--shortlist', str(root / 'functions-shortlist.json')],
                capture_output=True, text=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn('GNG_FUNCTION_INVENTORY=PASS', proc.stdout)
            self.assertIn('GNG_FUNCTION_SHORTLIST=PARTIAL', proc.stdout)
            exported = json.loads((root / 'functions-inventory.json').read_text())
            self.assertEqual(exported['exported_function_count'], 3)
            shortlisted = json.loads((root / 'functions-shortlist.json').read_text())
            self.assertEqual(shortlisted['items'][0]['entry'], '0x7000')

    def test_shortlist_never_marks_irq_or_reset_as_eligible(self):
        raw, image = synthetic()
        from function_inventory import inventory
        _, result = inventory(raw, image, max_shortlist=1)
        self.assertTrue(result['acceptance_met'])
        self.assertEqual(result['items'][0]['entry'], '0x7000')
        raw['functions'] = raw['functions'][:2]
        _, result = inventory(raw, image, max_shortlist=1)
        self.assertFalse(result['acceptance_met'])

class RealBankSelectorPatternTests(unittest.TestCase):
    def test_extended_sta_select_bank_disqualified(self):
        raw, image = synthetic()
        image = bytearray(image)
        image[0x7000:0x7003] = bytes.fromhex('b73e00')
        raw['functions'][2]['instructions'][0].update(raw='b73e00', length=3,
            assembly='STA $3e00', pcode_status='native', pcode=[
            {'op':'STORE', 'space_name':'RAM', 'output':None,
             'inputs':[{'space':'const','offset':'0x1','size':8},
                       {'space':'register','offset':'0x10','size':2},
                       {'space':'register','offset':'0x0','size':1}]},
            {'op':'RETURN','output':None,'inputs':[{'space':'register','offset':'0x2','size':2}]}])
        inv, shortlist = inventory(raw, bytes(image))
        candidate = next(c for c in inv['candidates'] if c['entry'] == '0x7000')
        self.assertIn('writes-bank-select-register: 0x3e00', candidate['review_blockers'])
        self.assertEqual(candidate['metrics']['bank_select_write_sites'], ['0x7000'])
        self.assertNotEqual(candidate['classification'], 'eligible-for-codegen-review')
        self.assertEqual(shortlist['eligible_for_codegen_review'], 0)

    def test_extended_stb_bank_selector_also_blocked(self):
        raw, image = synthetic()
        image = bytearray(image)
        image[0x7000:0x7003] = bytes.fromhex('f73e00')
        raw['functions'][2]['instructions'][0].update(raw='f73e00', length=3,
            assembly='STB $3e00')
        inv, _ = inventory(raw, bytes(image))
        candidate = next(c for c in inv['candidates'] if c['entry'] == '0x7000')
        self.assertIn('writes-bank-select-register: 0x3e00', candidate['review_blockers'])

class InferredCallFlowRegressions(unittest.TestCase):
    def test_inferred_return_continuation_does_not_make_pure_routine(self):
        raw, image = synthetic()
        raw['functions'][0]['instructions'][0]['fallthrough_source'] = '6809-call-return-inferred'
        inv, _ = inventory(raw, image)
        found = next(x for x in inv['candidates'] if x['entry'] == '0x6000')
        self.assertIn('call-return-continuation-unverified', found['review_blockers'])
        self.assertEqual(found['metrics']['speculative_call_continuation_sites'], ['0x6000'])

    def test_forged_inferred_continuation_fails_closed(self):
        raw, image = synthetic()
        call = raw['functions'][0]['instructions'][0]
        call['fallthrough_source'] = '6809-call-return-inferred'
        call['fallthrough'] = '0x6123'
        with self.assertRaisesRegex(ValueError, 'Invalid inferred call continuation'):
            inventory(raw, image)

    def test_inference_for_noncall_fails_closed(self):
        raw, image = synthetic()
        call = raw['functions'][0]['instructions'][0]
        call['fallthrough_source'] = '6809-call-return-inferred'
        call['flow_type'] = 'FALL_THROUGH'
        call['flows'] = []
        with self.assertRaisesRegex(ValueError, 'Invalid inferred call continuation'):
            inventory(raw, image)

class AnchoredJsRProbeTests(unittest.TestCase):
    def _irq_fixture(self):
        raw, image = synthetic()
        image = bytearray(image)
        # Real gngb-style IRQ BSR followed by two syntactic JSR opcodes.
        image[0x65c4] = 0x12
        image[0x65d1:0x65d3] = bytes.fromhex('8d28')
        image[0x65d3:0x65d9] = bytes.fromhex('bd6755bd6772')
        image[0x65d9] = 0xc6  # Next byte is not JSR: stop.
        raw['functions'][1]['instructions'] = [
            {'address':'0x65c4', 'raw':'12', 'length':1, 'assembly':'NOP',
             'flow_type':'FALL_THROUGH', 'fallthrough':None, 'flows':[],
             'pcode':[], 'pcode_status':'verified-nop'},
            {'address':'0x65d1', 'raw':'8d28', 'length':2, 'assembly':'BSR 0x65fb',
             'flow_type':'UNCONDITIONAL_CALL', 'fallthrough':'0x65d3',
             'flows':['0x65fb'], 'pcode_status':'native',
             'pcode':[{'op':'CALL','output':None,'inputs':[]}]},
        ]
        raw['functions'][2]['entry'] = '0x65fb'
        raw['functions'][2]['name'] = 'rom_65fb'
        raw['functions'][2]['instructions'][0]['address'] = '0x65fb'
        image[0x65fb] = 0x39
        raw['functions'][0]['instructions'][0]['flows'] = ['0x65fb']
        image[0x6001:0x6003] = bytes.fromhex('65fb')
        raw['functions'][0]['instructions'][0]['raw'] = 'bd65fb'
        return raw, bytes(image)

    def test_genuine_call_anchor_yields_only_syntactic_seeds(self):
        from function_inventory import anchored_jsr_probes
        raw, image = self._irq_fixture()
        inv, shortlist = inventory(raw, image)
        probes = inv['anchored_jsr_probes']
        self.assertEqual([p['target'] for p in probes], ['0x6755', '0x6772'])
        self.assertTrue(all(p['execution_proven'] is False for p in probes))
        self.assertTrue(all(p['ghidra_disassembly_verified'] is False for p in probes))
        candidate = next(c for c in inv['candidates'] if c['entry'] == '0x6755')
        self.assertEqual(candidate['discovery'], 'not-yet-exported')
        self.assertIn('seed-has-no-vector-or-decoded-call-provenance', candidate['review_blockers'])
        self.assertFalse(shortlist['acceptance_met'])

    def test_probe_stops_when_following_bytes_not_jsr(self):
        from function_inventory import anchored_jsr_probes
        raw, image = self._irq_fixture()
        self.assertEqual(len(anchored_jsr_probes(raw,image)),2)
        raw['functions'][1]['instructions'][1]['flow_type'] = 'FALL_THROUGH'
        self.assertEqual(len(anchored_jsr_probes(raw,image)),0)

    def test_probe_does_not_override_ghidra_decoded_instruction(self):
        from function_inventory import anchored_jsr_probes
        raw, image = self._irq_fixture()
        raw['functions'][1]['instructions'].append({
            'address':'0x65d3','raw':'bd6755','length':3,
            'assembly':'JSR $6755','flow_type':'UNCONDITIONAL_CALL',
            'fallthrough':'0x65d6', 'flows':['0x6755'],
            'pcode_status':'native','pcode':[{'op':'CALL','inputs':[]}]})
        probes=anchored_jsr_probes(raw,image)
        # The first JSR is already Ghidra-decoded; the next one remains an
        # independently anchored byte probe, not a confirmed execution path.
        self.assertEqual([p['call_site'] for p in probes], ['0x65d6'])
        self.assertEqual([p['target'] for p in probes], ['0x6772'])


class GhidraAnchoredJsRConfirmationTests(unittest.TestCase):
    def _fixture(self):
        raw, image = synthetic()
        image = bytearray(image)
        # After the already Ghidra-decoded 0x6000 CALL, the ROM contains
        # a second syntactic JSR. Real instruction verification is done
        # by the Java exporter; this fixture simulates its JSON contract.
        image[0x6003:0x6006] = bytes.fromhex('bd65fb')
        raw['functions'][0]['instructions'] = raw['functions'][0]['instructions'][:1]
        raw['anchored_verified_calls'] = [{
            'anchor_call_site':'0x6000','call_site':'0x6003',
            'target':'0x65fb','source':'ghidra-anchored-jsr',
            'ghidra_decoded':True,'return_semantics_verified':False,
            'target_resolution':'6809-jsr-extended-operand',
            'target_from_isa_encoding':True,
            'ghidra_flow_type':'COMPUTED_CALL'
        }]
        raw['anchored_rejected_probes'] = []
        return raw, bytes(image)

    def test_confirmation_adds_candidate_not_false_pure_function(self):
        raw, image = self._fixture()
        result, _ = inventory(raw, image)
        candidate = next(c for c in result['candidates'] if c['entry'] == '0x65fb')
        self.assertTrue(candidate['independent_entry_evidence'])
        self.assertEqual(candidate['discovery'], 'not-yet-exported')
        self.assertIn('anchored-call-return-not-verified', candidate['review_blockers'])
        self.assertEqual(len(result['ghidra_confirmed_anchored_calls']), 1)

    def test_confirmed_call_must_match_rom_opcode_and_target(self):
        raw, image = self._fixture()
        raw['anchored_verified_calls'][0]['target'] = '0x6755'
        with self.assertRaisesRegex(ValueError,'Anchored JSR target mismatch'):
            inventory(raw,image)
        raw, image = self._fixture()
        raw['anchored_verified_calls'][0]['call_site'] = '0x6004'
        with self.assertRaisesRegex(ValueError, 'Unaligned anchored JSR'):
            inventory(raw,image)

    def test_fake_return_verification_rejected(self):
        raw, image = self._fixture()
        raw['anchored_verified_calls'][0]['return_semantics_verified'] = True
        with self.assertRaisesRegex(ValueError,'Invalid anchored JSR confirmation'):
            inventory(raw,image)

class ComputedExtendedJsRProvenanceTests(unittest.TestCase):
    def _fixture(self):
        return GhidraAnchoredJsRConfirmationTests()._fixture()

    def test_computed_jsr_is_evidence_but_never_reachability(self):
        raw, image = self._fixture()
        result, selection = inventory(raw, image)
        evidence = result['ghidra_confirmed_anchored_calls'][0]
        self.assertEqual(evidence['target_resolution'], '6809-jsr-extended-operand')
        candidate = next(x for x in result['candidates'] if x['entry'] == '0x65fb')
        self.assertIn('anchored-call-return-not-verified', candidate['review_blockers'])
        self.assertFalse(selection['acceptance_met'])

    def test_computed_jsr_missing_resolution_fails(self):
        raw, image = self._fixture()
        del raw['anchored_verified_calls'][0]['target_resolution']
        with self.assertRaisesRegex(ValueError, 'Missing or unsupported'):
            inventory(raw, image)

    def test_isa_resolution_not_claimed_on_noncomputed_flow(self):
        raw, image = self._fixture()
        raw['anchored_verified_calls'][0]['ghidra_flow_type'] = 'UNCONDITIONAL_CALL'
        with self.assertRaisesRegex(ValueError, 'Invalid computed'):
            inventory(raw, image)

    def test_isa_resolution_flag_must_be_true(self):
        raw, image = self._fixture()
        raw['anchored_verified_calls'][0]['target_from_isa_encoding'] = False
        with self.assertRaisesRegex(ValueError, 'Invalid computed'):
            inventory(raw, image)
