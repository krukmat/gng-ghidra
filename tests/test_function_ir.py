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