"""Fail-closed 6809 P-code memory range proof regression tests."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'src'))
from memory_analysis import audit_function_memory, _decision, summarize_accesses

def v(space,offset,size):
    return {'space':space,'offset':hex(offset),'size':size}

def routine(ops):
    return {'entry':'0x7000','instructions':[{'address':'0x7000',
         'assembly':'SYNTHETIC','pcode':ops}]}

def store(pointer,size=1):
    return {'op':'STORE','space_name':'RAM','output':None,'inputs':[
        v('const',1,8),pointer,v('register',0,size)]}

def copy(pointer,out):
    return {'op':'COPY','inputs':[pointer],'output':out}

class MemoryAnalysisTests(unittest.TestCase):
    def test_unknown_16bit_pointer_remains_unsafe(self):
        a=audit_function_memory(routine([store(v('register',10,2))]))
        self.assertEqual(a[0]['interval'],[0,65535])
        self.assertFalse(a[0]['safe_for_pure_codegen'])

    def test_8bit_pointer_is_provably_low_ram(self):
        a=audit_function_memory(routine([store(v('register',10,1))]))
        self.assertEqual(a[0]['classification'],'safe-ram')

    def test_unique_mask_bounds_pointer_to_ram(self):
        p=v('unique',0x100,2)
        ops=[
            {'op':'INT_AND','inputs':[v('register',10,2),v('const',0x1fff,2)],
             'output':p},
            store(p,2),
        ]
        a=audit_function_memory(routine(ops))
        self.assertEqual(a[0]['interval'],[0,0x1fff])
        self.assertTrue(a[0]['safe_for_pure_codegen'])

    def test_unsafe_mmio_and_rom_store_block(self):
        for ptr in [0x3000,0x3e00,0x4000,0xffff]:
            with self.subTest(ptr=ptr):
                a=audit_function_memory(routine([store(v('const',ptr,2))]))
                self.assertFalse(a[0]['safe_for_pure_codegen'])

    def test_read_rom_is_safe_not_mmio(self):
        p={'op':'LOAD','space_name':'RAM','output':v('register',0,1),
           'inputs':[v('const',1,8),v('const',0x6000,2)]}
        a=audit_function_memory(routine([p]))
        self.assertEqual(a[0]['classification'],'safe-rom-read')

    def test_mmio_crossing_word_is_unsafe(self):
        a=audit_function_memory(routine([store(v('const',0x2fff,2),2)]))
        self.assertFalse(a[0]['safe_for_pure_codegen'])

    def test_overflow_must_not_prove_low_ram(self):
        p=v('unique',0x100,2)
        ops=[{'op':'INT_ADD','inputs':[v('register',10,2),v('const',1,2)],
              'output':p},store(p)]
        a=audit_function_memory(routine(ops))
        self.assertEqual(a[0]['interval'],[0,65535])
        self.assertFalse(a[0]['safe_for_pure_codegen'])

    def test_unsupported_overwrite_invalidates_unique(self):
        p=v('unique',0x100,2)
        ops=[copy(v('const',0x123,2),p),
             {'op':'INT_XOR','inputs':[v('register',10,2),v('register',12,2)],
              'output':p},store(p)]
        a=audit_function_memory(routine(ops))
        self.assertFalse(a[0]['safe_for_pure_codegen'])

    def test_no_provenance_crosses_instruction(self):
        p=v('unique',0x100,2)
        f=routine([])
        f['instructions']=[
          {'address':'0x7000','assembly':'COPY','pcode':[copy(v('const',0x123,2),p)]},
          {'address':'0x7001','assembly':'STORE','pcode':[store(p)]}]
        a=audit_function_memory(f)
        self.assertFalse(a[0]['safe_for_pure_codegen'])

    def test_non_ram_memory_space_blocks(self):
        st=store(v('const',0x100,2));st['space_name']='bank1'
        a=audit_function_memory(routine([st]))
        self.assertFalse(a[0]['safe_for_pure_codegen'])

    def test_summary_has_no_false_green(self):
        a=audit_function_memory(routine([store(v('const',0x100,2)),
                                         store(v('register',10,2))]))
        self.assertEqual(summarize_accesses(a),
                         {'total':2,'safe':1,'unresolved_or_unsafe':1})

if __name__=='__main__':
    unittest.main()
