import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from function_ir import normalize, normalize_function
from pcode_codegen import compile_function, Unsupported

C = lambda x, n=2: {'space':'const','offset':f'0x{x:x}','size':n}
R = lambda x, n=2: {'space':'register','offset':f'0x{x:x}','size':n}

def simple(inst=None):
    p = inst or [{'op':'COPY','output':R(0),'inputs':[C(0x1234)]},
                 {'op':'RETURN','output':None,'inputs':[C(0)]}]
    return {'entry':'0x7000','name':'test','bank_context':'bank4', 'instructions':[
        {'address':'0x7000', 'length':1, 'raw':'12', 'assembly':'NOP',
         'fallthrough': None, 'flows': [], 'flow_type':'TERMINATOR', 'pcode':p}]}

class FunctionIRTests(unittest.TestCase):
    def test_typed_ir(self):
        f = normalize_function(simple())
        self.assertEqual(f['instruction_count'],1)
        self.assertEqual(f['blocks'][0]['instructions'][0]['pcode'][0]['output']['size'],2)
        self.assertIn('case 28672',compile_function(f))

    def test_unsupported_pcode_fails_closed(self):
        f = simple([{'op':'CALLOTHER','output':None,'inputs':[C(1)]}])
        with self.assertRaisesRegex(Unsupported, 'CALLOTHER'):
            compile_function(normalize_function(f))

    def test_unresolved_edge_fails_closed(self):
        f = simple()
        f['instructions'][0]['flows']=['0x7100']
        with self.assertRaisesRegex(Unsupported, 'External edges'):
            compile_function(normalize_function(f))

    def test_unresolved_branch_fails_closed(self):
        f = simple([{'op':'BRANCH','output':None,'inputs':[{'space':'ram','offset':'0x7200','size':2}]}])
        with self.assertRaisesRegex(Unsupported, 'Unresolved branch'):
            compile_function(normalize_function(f))

    def test_unmapped_bank_rejected(self):
        f = simple(); f['bank_context']='bank2'
        with self.assertRaisesRegex(ValueError,'Unknown bank'):
            normalize({'schema':'gng.ghidra-functions.v1','processor':'6809:BE:16:default',
                       'bank_context':'bank4','functions':[f],'skipped':[]})

    def test_bad_width_rejected(self):
        f = simple(); f['instructions'][0]['pcode'][0]['output']['size']=0
        with self.assertRaisesRegex(ValueError,'size'):
            normalize_function(f)

    def test_bad_instruction_length(self):
        f = simple(); f['instructions'][0]['length']=2
        with self.assertRaisesRegex(ValueError,'length'):
            normalize_function(f)

if __name__ == '__main__': unittest.main()

class BankSafetyTests(unittest.TestCase):
    def test_external_fallthrough_rejected(self):
        f = simple()
        f['instructions'][0]['fallthrough'] = '0x7100'
        with self.assertRaisesRegex(Unsupported,'External edges'):
            compile_function(normalize_function(f))

    def test_memory_space_must_be_named(self):
        store = {'op':'STORE','output':None,'inputs':[C(1,1), R(0), C(5,1)]}
        f = normalize_function(simple([store, {'op':'RETURN','output':None,'inputs':[C(0)]}]))
        with self.assertRaisesRegex(Unsupported,'unknown memory space'):
            compile_function(f)

    def test_register_width_preserved(self):
        f = normalize_function(simple())
        self.assertEqual(f['blocks'][0]['instructions'][0]['pcode'][0]['output'], R(0))


class EmptyPcodeTests(unittest.TestCase):
    def test_real_rom_sync_preserved_but_codegen_blocked(self):
        raw = simple([])
        raw['instructions'][0].update(address='0x6016', raw='13', assembly='SYNC',
                                      pcode=[], pcode_status='unmodeled-wait-for-interrupt')
        raw['entry'] = '0x6016'
        normalized = normalize_function(raw)
        self.assertEqual(normalized['blocks'][0]['instructions'][0]['pcode'], [])
        with self.assertRaisesRegex(Unsupported, 'wait-for-interrupt'):
            compile_function(normalized)

    def test_no_pcode_nop_can_compile(self):
        raw = simple([])
        raw['instructions'][0].update(pcode=[], pcode_status='verified-nop')
        normalized = normalize_function(raw)
        self.assertIn('case 28672', compile_function(normalized))

    def test_unknown_empty_pcode_is_not_silently_ignored(self):
        raw = simple([])
        raw['instructions'][0].update(pcode=[], pcode_status='unmodeled-empty-pcode', assembly='UNKNOWN')
        with self.assertRaisesRegex(Unsupported, 'unmodeled-empty-pcode'):
            compile_function(normalize_function(raw))

    def test_bad_nop_provenance_rejected(self):
        raw = simple([])
        raw['instructions'][0].update(raw='13', assembly='SYNC', pcode=[], pcode_status='verified-nop')
        with self.assertRaisesRegex(ValueError, 'NOP provenance'):
            normalize_function(raw)

    def test_truncated_function_fails_codegen(self):
        raw = simple()
        raw['truncated'] = True
        with self.assertRaisesRegex(Unsupported, 'Partial CFG'):
            compile_function(normalize_function(raw))

class GhidraAddressSpaceRegressionTests(unittest.TestCase):
    """Ghidra 12.1.4 on macOS uses uppercase RAM for its default memory space."""

    def test_actual_exported_ram_alias_in_pcode_branch(self):
        first = {'address': '0x7000', 'length': 2, 'raw': '20fe',
                 'assembly': 'BRA 0x7000', 'flow_type': 'UNCONDITIONAL_JUMP',
                 'fallthrough': None, 'flows': ['0x7000'], 'pcode_status': 'native',
                 'pcode': [{'op': 'BRANCH', 'output': None,
                            'inputs': [{'space': 'RAM', 'offset': '0x7000', 'size': 2}]}]}
        f = {'entry': '0x7000', 'name': 'rom_7000', 'bank_context': 'bank4',
             'instructions': [first]}
        ir = normalize_function(f)
        item = ir['blocks'][0]['instructions'][0]['pcode'][0]
        self.assertEqual(item['inputs'][0]['space'], 'ram')
        js = compile_function(ir)
        self.assertIn('pc = 28672', js)

    def test_uppercase_default_ram_space_on_load_codegen(self):
        f = simple([{'op': 'LOAD', 'output': {'space': 'REGISTER', 'offset': '0x0', 'size': 1},
                     'inputs': [{'space': 'CONST', 'offset': '0x1', 'size': 1},
                                {'space': 'CONST', 'offset': '0x1e00', 'size': 2}],
                     'space_name': 'RAM'},
                    {'op': 'RETURN', 'output': None, 'inputs': [C(0)]}])
        ir = normalize_function(f)
        p = ir['blocks'][0]['instructions'][0]['pcode'][0]
        self.assertEqual(p['space_name'], 'ram')
        self.assertEqual(p['output']['space'], 'register')
        self.assertEqual(p['inputs'][0]['space'], 'const')
        js = compile_function(ir)
        self.assertIn('memRead(', js)

    def test_unknown_overlay_varnode_still_rejected(self):
        f = simple()
        f['instructions'][0]['pcode'][0]['output']['space'] = 'BANK_3'
        with self.assertRaisesRegex(ValueError, 'Unsupported varnode space'):
            normalize_function(f)

    def test_unknown_memory_overlay_not_treated_as_default_ram(self):
        f = simple([{'op': 'LOAD', 'output': R(0, 1),
                     'inputs': [C(1, 1), C(0x1000, 2)], 'space_name': 'BANK_3'},
                    {'op': 'RETURN', 'output': None, 'inputs': [C(0)]}])
        with self.assertRaisesRegex(Unsupported, 'unknown memory space'):
            compile_function(normalize_function(f))

    def test_full_bundle_with_ghidra_uppercase_spaces(self):
        f = simple([{'op': 'COPY', 'output': {'space': 'REGISTER', 'offset': '0x0', 'size': 2},
                     'inputs': [{'space': 'CONST', 'offset': '0x1234', 'size': 2}]},
                    {'op': 'RETURN', 'output': None, 'inputs': [C(0)]}])
        bundle = normalize({'schema': 'gng.ghidra-functions.v1',
                            'processor': '6809:BE:16:default', 'bank_context': 'bank4',
                            'functions': [f], 'skipped': []})
        self.assertEqual(len(bundle['functions']), 1)
        self.assertEqual(bundle['skipped'], [])
        self.assertIn('case 28672', compile_function(bundle['functions'][0]))
