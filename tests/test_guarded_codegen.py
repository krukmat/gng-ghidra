"""Synthetic guarded JS execution, strict nonmutating failure behavior."""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from guarded_codegen import guard_source, build, EXPECTED
from pcode_codegen import compile_function, Unsupported
from function_inventory import rom_vectors

def n(space, off, size):
    return {'space':space,'offset':hex(off),'size':size}

def ir_ops(entry=0x622c, ops=None):
    if ops is None:
        ops=[
            {'op':'LOAD','space_name':'ram',
             'inputs':[n('const',1,8), n('const',0xd8,2)],
             'output':n('register',0,1)},
            {'op':'RETURN','inputs':[n('register',24,2)],'output':None},
        ]
    return {
        'entry':f'0x{entry:04x}','bank_context':'bank4',
        'truncated':False,'external_edges':[],
        'blocks':[{'instructions':[{
            'address':f'0x{entry:04x}','raw':'39','assembly':'RTS',
            'pcode_status':'native','fallthrough':None,
            'pcode':ops,
        }]}],
    }

def create_synthetic_raw():
    image=bytearray(0x10000)
    image[0xfff2:0x10000]=b'\xff'*14
    image[0xfff8:0xfffa]=bytes.fromhex('65c4')
    image[0xfffe:0x10000]=bytes.fromhex('6000')
    for pc in [0x6000,0x65c4,0x622c]:
        image[pc]=0x39
    def routine(entry,ops):
        return {
            'entry':f'0x{entry:04x}','name':f'rom_{entry:04x}',
            'bank_context':'bank4', 'instructions':[{
              'address':f'0x{entry:04x}', 'length':1, 'raw':'39',
              'assembly':'RTS','flow_type':'TERMINATOR','flows':[],
              'fallthrough':None,'pcode_status':'native','pcode':ops,
            }]
        }
    entry = routine(0x622c,ir_ops()['blocks'][0]['instructions'][0]['pcode'])
    raw={'schema':'gng.ghidra-functions.v1',
         'processor':'6809:BE:16:default','bank_context':'bank4',
         'functions':[routine(0x6000,[]), routine(0x65c4,[]),entry],
         'vectors':rom_vectors(bytes(image)),'skipped':[]}
    return raw,bytes(image)

@unittest.skipUnless(shutil.which('node'), 'Node required')
class GuardedCodegenTests(unittest.TestCase):
    def run_js(self, code, assertions):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'guarded.mjs'
            out.write_text(code)
            test=Path(tmp)/'test.mjs'
            test.write_text(f"import {{runRoutine}} from './guarded.mjs';\n{assertions}")
            proc=subprocess.run(['node',str(test)],capture_output=True,text=True,timeout=20)
            self.assertEqual(proc.returncode,0,proc.stderr)

    def test_guarded_execution_preserves_input_and_reports_output(self):
        code=guard_source(compile_function(ir_ops()))
        self.run_js(code, """
import assert from 'node:assert/strict';
const m=new Uint8Array(65536), r=new Uint8Array(256);
r[9]=0; r[24]=2; r[25]=0; m[0xd8]=0x42;
const got=runRoutine(m,r,4);
assert.equal(got.registers[0],0x42);
assert.equal(r[0],0);
assert.equal(got.memory[0xd8],0x42);
assert.notStrictEqual(got.memory,m);
""")

    def test_rejects_bad_entry_before_mutation(self):
        code=guard_source(compile_function(ir_ops()))
        self.run_js(code, """
import assert from 'node:assert/strict';
const m=new Uint8Array(65536), r=new Uint8Array(256);
r[9]=1; r[24]=2; r[25]=0; m[0xd8]=0x17;
assert.throws(()=>runRoutine(m,r),/DP\\/S contract/);
assert.equal(m[0xd8],0x17);
assert.equal(r[9],1);
r[9]=0;r[24]=0x3e;r[25]=0;
assert.throws(()=>runRoutine(m,r),/DP\\/S contract/);
""")

    def test_mid_instruction_stack_change_rejected_without_input_mutation(self):
        # The guards are checked immediately before each RAM operation.
        ops=[
            {'op':'STORE','space_name':'ram',
             'inputs':[n('const',1,8), n('const',0x30,2),n('const',0xaa,1)],
             'output':None},
            {'op':'COPY','output':n('register',24,2),
             'inputs':[n('const',0x3e00,2)]},
            {'op':'LOAD','space_name':'ram',
             'inputs':[n('const',1,8),n('register',24,2)],
             'output':n('register',0,1)},
            {'op':'RETURN','inputs':[n('register',24,2)],'output':None},
        ]
        code=guard_source(compile_function(ir_ops(ops=ops)))
        self.run_js(code, """
import assert from 'node:assert/strict';
const m=new Uint8Array(65536),r=new Uint8Array(256);
r[24]=2;r[25]=0;
assert.throws(()=>runRoutine(m,r),/DP\\/S contract/);
assert.equal(m[0x30],0);
assert.equal(r[24],2);
""")

    def test_uninstrumentable_codegen_fails_closed(self):
        with self.assertRaisesRegex(Unsupported,'anchor'):
            guard_source("export function runRoutine() {}")

    def test_unmodelled_pcode_keeps_codegen_blocked(self):
        broken=ir_ops(ops=[{'op':'BRANCHIND','output':None,
                           'inputs':[n('register',18,2)]}])
        with self.assertRaisesRegex(Unsupported,'interprocedural'):
            guard_source(compile_function(broken))

    def test_writes_into_rom_keep_runtime_guard(self):
        ops=[
            {'op':'STORE','space_name':'ram',
             'inputs':[n('const',1,8),n('const',0x3e00,2),n('const',1,1)],
             'output':None},
        ]
        code=guard_source(compile_function(ir_ops(ops=ops)))
        self.run_js(code, """
import assert from 'node:assert/strict';
const m=new Uint8Array(65536),r=new Uint8Array(256);r[24]=2;
assert.throws(()=>runRoutine(m,r),/MMIO or ROM/);
assert.equal(m[0x3e00],0);
""")

    def test_cli_builder_does_not_bypass_rom_audit_or_counts(self):
        raw,image=create_synthetic_raw()
        with tempfile.TemporaryDirectory() as tmp:
            r=build(raw,image,Path(tmp),['0x622c'])
            self.assertEqual(len(r['generated']),0)
            self.assertEqual(len(r['blocked']),1)
            self.assertIn('obligations',r['blocked'][0]['reason'])
        edited=bytearray(image);edited[0x622c]=0x12
        with self.assertRaisesRegex(ValueError,'ROM bytes differ'):
            build(raw,bytes(edited),Path('/tmp/guarded-test'),['0x622c'])

if __name__=='__main__':
    unittest.main()


class GuardedArtifactIntegrityTests(unittest.TestCase):
    def test_generated_module_has_matching_sha256_in_manifest(self):
        import copy
        raw, image = create_synthetic_raw()
        entry = raw['functions'][2]['instructions'][0]
        # Exactly three legitimate reads, matching the 0x622c obligation
        # count, without any assumption about a real game's DP/S state.
        template = copy.deepcopy(entry['pcode'][0])
        for i in (1, 2):
            other = copy.deepcopy(template)
            other['inputs'][1]['offset'] = hex(0xd8 + i)
            other['output']['offset'] = hex(i)
            entry['pcode'].insert(i, other)
        with tempfile.TemporaryDirectory() as tmp:
            report = build(raw, image, Path(tmp), ['0x622c'])
            self.assertEqual(report['blocked'], [])
            self.assertEqual(len(report['generated']), 1)
            generated = report['generated'][0]
            js = Path(generated['javascript']).read_bytes()
            self.assertEqual(generated['sha256'], hashlib.sha256(js).hexdigest())
            self.assertIn(b'Unmet experimental DP/S contract', js)
            self.assertFalse(generated['equivalence_verified'])

class DirectRamRuntimeTests(GuardedCodegenTests):
    def test_direct_ram_read_and_write_in_ram(self):
        ops=[
            {'op':'COPY','inputs':[n('ram',0x40,1)],
             'output':n('register',0,1)},
            {'op':'COPY','inputs':[n('register',0,1)],
             'output':n('ram',0x41,1)},
            {'op':'RETURN','inputs':[n('register',24,2)],'output':None},
        ]
        code=guard_source(compile_function(ir_ops(ops=ops)))
        self.run_js(code, """
import assert from 'node:assert/strict';
const m=new Uint8Array(65536),r=new Uint8Array(256);
r[24]=2;m[0x40]=0x73;
const got=runRoutine(m,r,3);
assert.equal(got.registers[0],0x73);
assert.equal(got.memory[0x41],0x73);
assert.equal(m[0x41],0);
""")

    def test_direct_mmio_read_is_not_faked_as_ram(self):
        ops=[
            {'op':'COPY','inputs':[n('ram',0x3003,1)],
             'output':n('register',0,1)},
            {'op':'RETURN','inputs':[n('register',24,2)],'output':None},
        ]
        code=guard_source(compile_function(ir_ops(ops=ops)))
        self.run_js(code, """
import assert from 'node:assert/strict';
const m=new Uint8Array(65536),r=new Uint8Array(256);
r[24]=2;
assert.throws(()=>runRoutine(m,r),/I\\/O read requires hardware adapter/);
assert.equal(r[0],0);
""")

    def test_direct_mmio_write_is_rejected(self):
        ops=[
            {'op':'COPY','inputs':[n('register',0,1)],
             'output':n('ram',0x3d00,1)},
            {'op':'RETURN','inputs':[n('register',24,2)],'output':None},
        ]
        code=guard_source(compile_function(ir_ops(ops=ops)))
        self.run_js(code, """
import assert from 'node:assert/strict';
const m=new Uint8Array(65536),r=new Uint8Array(256);
r[24]=2;r[0]=0x5a;
assert.throws(()=>runRoutine(m,r),/MMIO or ROM/);
assert.equal(m[0x3d00],0);
""")

    def test_direct_varnode_crossing_64k_boundary_rejected(self):
        ops=[{'op':'COPY','inputs':[n('ram',0xffff,2)],
              'output':n('register',0,2)}]
        with self.assertRaisesRegex(Unsupported,'outside 6809 map'):
            compile_function(ir_ops(ops=ops))

class DirectRamSafetyGateTests(unittest.TestCase):
    def test_guarded_builder_rejects_hidden_mmio_reads(self):
        import copy
        raw,image=create_synthetic_raw()
        ins=raw['functions'][2]['instructions'][0]
        template=copy.deepcopy(ins['pcode'][0])
        for i in (1,2):
            other=copy.deepcopy(template)
            other['inputs'][1]['offset']=hex(0xd8+i)
            ins['pcode'].insert(i,other)
        ins['pcode'].insert(0,{
            'op':'COPY','inputs':[n('ram',0x3003,1)],
            'output':n('register',0,1)})
        with tempfile.TemporaryDirectory() as tmp:
            report=build(raw,image,Path(tmp),['0x622c'])
            self.assertEqual(len(report['generated']),0)
            self.assertEqual(len(report['blocked']),1)
            self.assertIn('mmio-forbidden',report['blocked'][0]['reason'])
            self.assertIn('3/4',report['blocked'][0]['reason'])

    def test_guarded_builder_rejects_hidden_mmio_writes(self):
        import copy
        raw,image=create_synthetic_raw()
        ins=raw['functions'][2]['instructions'][0]
        template=copy.deepcopy(ins['pcode'][0])
        for i in (1,2):
            other=copy.deepcopy(template)
            other['inputs'][1]['offset']=hex(0xd8+i)
            ins['pcode'].insert(i,other)
        ins['pcode'].insert(0,{
            'op':'COPY','inputs':[n('register',0,1)],
            'output':n('ram',0x3d00,1)})
        with tempfile.TemporaryDirectory() as tmp:
            report=build(raw,image,Path(tmp),['0x622c'])
            self.assertEqual(len(report['generated']),0)
            self.assertIn('mmio-forbidden',report['blocked'][0]['reason'])

