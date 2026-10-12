"""ROM-free pointer-origin diagnostics; never a memory safety proof."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from memory_provenance import CPU_REGISTERS, profile, summarize

def v(space,offset,size):
    return {'space':space,'offset':hex(offset),'size':size}

def mem(ptr,kind='LOAD'):
    d={'op':kind,'space_name':'RAM',
       'inputs':[v('const',1,8),ptr]}
    if kind=='LOAD':
        d['output']=v('unique',0x350,1)
    else:
        d['output']=None
        d['inputs'].append(v('register',0,1))
    return d

def fun(ops):
    return {'entry':'0x7000','instructions':[{'address':'0x7000',
              'assembly':'SYNTHETIC', 'pcode':ops}]}

class PointerProvenanceTests(unittest.TestCase):
    def test_cpu_register_names_match_6809_sleigh(self):
        self.assertEqual(CPU_REGISTERS[(24,2)],'S')
        self.assertEqual(CPU_REGISTERS[(18,2)],'X')
        self.assertEqual(CPU_REGISTERS[(20,2)],'Y')
        self.assertEqual(CPU_REGISTERS[(22,2)],'U')

    def test_stack_origin_behind_arithmetic_unique_not_marked_safe(self):
        ptr=v('unique',0x100,2)
        ops=[{'op':'INT_ADD','output':ptr,
              'inputs':[v('register',24,2),v('const',1,2)]},
             mem(ptr)]
        row=profile(fun(ops))[0]
        self.assertEqual(row['bucket'],'stack-S')
        self.assertEqual(row['sources'],['S'])
        self.assertFalse(row['safe'])
        self.assertEqual(row['range'],[0,65535])

    def test_index_register_and_mixed_sources(self):
        a=v('unique',0x100,2)
        single=profile(fun([mem(v('register',18,2))]))[0]
        self.assertEqual(single['bucket'],'index-X')
        mixed=profile(fun([
            {'op':'INT_ADD','output':a,
             'inputs':[v('register',18,2),v('register',20,2)]},
            mem(a)]))[0]
        self.assertEqual(mixed['bucket'],'mixed-X,Y')
        self.assertFalse(mixed['safe'])

    def test_memory_load_output_is_not_inferred_from_address(self):
        # A 16-bit memory-derived pointer is unconstrained, unlike an
        # 8-bit value whose entire 0..255 range is legitimately in RAM.
        ptr=v('unique',0x350,2)
        ld=mem(v('register',24,2))
        ld['output']=ptr
        output=profile(fun([ld,mem(ptr,'STORE')]))
        self.assertEqual(output[1]['bucket'],'other-memory-value')
        self.assertFalse(output[1]['safe'])

    def test_unresolved_temp_and_literal(self):
        entries=profile(fun([mem(v('unique',0x101,2)),
                            mem(v('const',0x3000,2),'STORE')]))
        self.assertEqual(entries[0]['bucket'],'other-unresolved-unique')
        self.assertEqual(entries[1]['bucket'],'literal')
        self.assertFalse(entries[1]['safe'])

    def test_unique_scope_does_not_cross_instruction(self):
        pointer=v('unique',0x100,2)
        f=fun([])
        f['instructions']=[
          {'address':'0x7000','assembly':'copy',
           'pcode':[{'op':'COPY','output':pointer,
                     'inputs':[v('register',24,2)]}]},
          {'address':'0x7001','assembly':'load',
           'pcode':[mem(pointer)]},
        ]
        row=profile(f)[0]
        self.assertEqual(row['bucket'],'other-unresolved-unique')

    def test_summary_counts_preserve_unknown_safety(self):
        result=summarize({'functions':[fun([mem(v('register',24,2)),
                                              mem(v('register',18,2))])]},
                         ['0x7000'],0)
        self.assertEqual(result[0]['count'],2)
        self.assertEqual(result[0]['safe'],0)
        self.assertEqual(result[0]['buckets'],{'index-X':1,'stack-S':1})

    def test_reject_unknown_entry(self):
        with self.assertRaisesRegex(ValueError,'Unknown function entries'):
            summarize({'functions':[fun([])]},['0x1234'])

if __name__=='__main__':
    unittest.main()
