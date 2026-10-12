"""ROM-free hypothetical DP/S contract analysis; fail-closed regressions."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from memory_contracts import evaluate,report

def v(space,off,size):
    return {'space':space,'offset':hex(off),'size':size}
def mem(op,ptr,size=1):
    p={'op':op,'space_name':'RAM','inputs':[v('const',1,8),ptr]}
    if op=='LOAD':
        p['output']=v('register',0,size)
    else:
        p['output']=None
        p['inputs'].append(v('register',0,size))
    return p
def f(*ops):
    return {'entry':'0x622c','instructions':[{
        'address':'0x622c','assembly':'synthetic','pcode':list(ops)}]}

class ContractTests(unittest.TestCase):
    def test_unproven_stack_hypothesis(self):
        result=evaluate(f(mem('LOAD',v('register',24,2),2)))
        self.assertEqual(result['conditionally_in_range'],1)
        self.assertFalse(result['entry_invariant_proven'])

    def test_direct_page_sleigh_shift_add(self):
        dp=v('unique',0x100,2); shifted=v('unique',0x102,2); ptr=v('unique',0x104,2)
        result=evaluate(f(
            {'op':'INT_ZEXT','inputs':[v('register',9,1)],'output':dp},
            {'op':'INT_LEFT','inputs':[dp,v('const',8,1)],'output':shifted},
            {'op':'INT_ADD','inputs':[shifted,v('const',0xd8,2)],'output':ptr},
            mem('LOAD',ptr)))
        self.assertEqual(result['accesses'][0]['address_interval'],[216,216])

    def test_writing_dp_invalidates_same_instruction_assumption(self):
        dp=v('unique',0x102,2);ptr=v('unique',0x104,2)
        result=evaluate(f(
            {'op':'COPY','inputs':[v('register',18,1)],'output':v('register',9,1)},
            {'op':'INT_ZEXT','inputs':[v('register',9,1)],'output':dp},
            {'op':'INT_LEFT','inputs':[dp,v('const',8,1)],'output':ptr},
            mem('LOAD',ptr)))
        self.assertEqual(result['conditionally_in_range'],0)

    def test_alias_subregister_write_invalidates_S(self):
        result=evaluate(f(
            {'op':'COPY','inputs':[v('register',18,1)],'output':v('register',25,1)},
            mem('LOAD',v('register',24,2),2)))
        self.assertEqual(result['conditionally_in_range'],0)

    def test_alias_write_invalidates_dp(self):
        dp=v('unique',0x102,2);ptr=v('unique',0x104,2)
        result=evaluate(f(
            {'op':'COPY','inputs':[v('register',18,2)],'output':v('register',8,2)},
            {'op':'INT_ZEXT','inputs':[v('register',9,1)],'output':dp},
            {'op':'INT_LEFT','inputs':[dp,v('const',8,1)],'output':ptr},
            mem('LOAD',ptr)))
        self.assertEqual(result['conditionally_in_range'],0)

    def test_index_regs_not_trusted(self):
        result=evaluate(f(mem('LOAD',v('register',18,2)),
                          mem('STORE',v('register',22,2))))
        self.assertEqual(result['conditionally_in_range'],0)

    def test_mmio_and_rom_writes_forbidden(self):
        result=evaluate(f(mem('STORE',v('const',0x3e00,2)),
                          mem('STORE',v('const',0x6000,2))))
        self.assertEqual([x['hypothetical_classification'] for x in result['accesses']],
                         ['mmio-forbidden','rom-write-forbidden'])

    def test_stack_crossing_io_not_accepted(self):
        ptr=v('unique',0x140,2)
        result=evaluate(f(
            {'op':'INT_ADD','inputs':[v('register',24,2),v('const',0x100,2)],'output':ptr},
            mem('LOAD',ptr,2)))
        self.assertEqual(result['conditionally_in_range'],0)

    def test_stack_wrap_not_accepted(self):
        ptr=v('unique',0x140,2)
        result=evaluate(f(
            {'op':'INT_SUB','inputs':[v('register',24,2),v('const',0x200,2)],'output':ptr},
            mem('LOAD',ptr,2)))
        self.assertEqual(result['conditionally_in_range'],0)

    def test_unknown_overwrite_drops_temp_proof(self):
        ptr=v('unique',0x140,2)
        result=evaluate(f(
            {'op':'COPY','inputs':[v('const',0x200,2)],'output':ptr},
            {'op':'INT_XOR','inputs':[v('register',18,2),v('register',20,2)],'output':ptr},
            mem('LOAD',ptr)))
        self.assertEqual(result['conditionally_in_range'],0)

    def test_cross_instruction_hypothesis_still_unverified(self):
        func=f()
        func['instructions']=[
          {'address':'0x622c','pcode':[{'op':'COPY','inputs':[v('const',0x3e00,2)],
                                       'output':v('register',24,2)}]},
          {'address':'0x622e','pcode':[mem('LOAD',v('register',24,2),2)]}]
        result=evaluate(func)
        self.assertEqual(result['conditionally_in_range'],1)
        self.assertFalse(result['entry_invariant_proven'])

    def test_report_does_not_grant_codegen(self):
        output=report({'functions':[f(mem('LOAD',v('register',24,2)))]},['0x622c'])
        self.assertEqual(output['status'],'UNVERIFIED_ENTRY_INVARIANTS')
        self.assertIs(output['compiler_eligibility_changed'],False)

if __name__=='__main__':
    unittest.main()
