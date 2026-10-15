"""ROM-free board adapter regressions: compile gates and JS execution."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from board_codegen import audit_sites, board_source, build, BOARD_IO
from function_ir import normalize_function
from guarded_codegen import guard_source
from pcode_codegen import compile_function, Unsupported
from function_inventory import rom_vectors


def vn(space,offset,size=1):
    return {'space':space,'offset':hex(offset),'size':size}

def op_read(addr,reg=0):
    return {'op':'COPY','inputs':[vn('RAM',addr)],
            'output':vn('register',reg)}

def op_write(addr,reg=0):
    return {'op':'COPY','inputs':[vn('register',reg)],
            'output':vn('RAM',addr)}

def load_ram(addr,dest=2):
    return {'op':'LOAD','space_name':'RAM',
            'inputs':[vn('const',1,8),vn('const',addr,2)],
            'output':vn('register',dest)}

def ret():
    return {'op':'RETURN','inputs':[vn('register',24,2)],'output':None}

def raw_routine(entry,items):
    nodes=[]
    for i,(pc,ops) in enumerate(items):
        next_pc=items[i+1][0] if i+1<len(items) else None
        nodes.append({
            'address':hex(pc),'length':1,'raw':'39',
            'assembly':'synthetic','flow_type':'FALL_THROUGH' if next_pc else 'TERMINATOR',
            'flows':[], 'fallthrough':hex(next_pc) if next_pc else None,
            'pcode_status':'native','pcode':ops,
        })
    return {'entry':hex(entry),'name':f'rom_{entry:x}',
            'bank_context':'bank4','instructions':nodes}

def candidate_622c():
    return raw_routine(0x622c,[
        (0x622c,[op_read(0x3003,0),load_ram(0x40,2),load_ram(0x41,3)]),
        (0x6232,[op_read(0x3004,1),load_ram(0x42,4)]),
        (0x6238,[ret()]),
    ])

def candidate_6755():
    return raw_routine(0x6755,[
        (0x6755,[load_ram(0x40,0),load_ram(0x41,1),
                  load_ram(0x42,2),load_ram(0x43,3),load_ram(0x44,4)]),
        (0x6759,[op_write(0x3d00,0)]),
        (0x675e,[op_write(0x3b09,1)]),
        (0x6761,[op_write(0x3b08,2)]),
        (0x676b,[op_write(0x3b0b,3)]),
        (0x676e,[op_write(0x3b0a,4)]),
        (0x6771,[ret()]),
    ])

def synthetic_image_and_raw():
    memory=bytearray(65536)
    memory[0xfff2:0x10000]=bytes([255])*14
    memory[0xfff8:0xfffa]=bytes.fromhex('65c4')
    memory[0xfffe:0x10000]=bytes.fromhex('6000')
    p0=raw_routine(0x6000,[(0x6000,[ret()])])
    irq=raw_routine(0x65c4,[(0x65c4,[ret()])])
    functions=[p0,irq,candidate_622c(),candidate_6755()]
    for routine in functions:
        for instruction in routine['instructions']:
            memory[int(instruction['address'],16)]=0x39
    return {
        'schema':'gng.ghidra-functions.v1',
        'processor':'6809:BE:16:default',
        'bank_context':'bank4',
        'functions':functions,
        'vectors':rom_vectors(bytes(memory)),
        'skipped':[],
    },bytes(memory)

class BoardCodegenTests(unittest.TestCase):
    def test_exact_synthetic_sites_approved(self):
        image=bytes(65536)
        for entry,func in [('0x622c',candidate_622c()),
                           ('0x6755',candidate_6755())]:
            got=audit_sites(func,entry,image)
            self.assertEqual(got['access_count'],5 if entry=='0x622c' else 10)
            self.assertEqual(got['conditionally_in_range'],3 if entry=='0x622c' else 5)

    def test_unknown_mmio_read_is_rejected_even_if_count_matches(self):
        f=candidate_622c()
        f['instructions'][1]['pcode'][0]['inputs'][0]['offset']='0x3005'
        with self.assertRaisesRegex(Unsupported,'MMIO site mismatch'):
            audit_sites(f,'0x622c',bytes(65536))

    def test_unknown_mmio_write_is_rejected_even_if_count_matches(self):
        f=candidate_6755()
        f['instructions'][4]['pcode'][0]['output']['offset']='0x3b0c'
        with self.assertRaisesRegex(Unsupported,'MMIO site mismatch'):
            audit_sites(f,'0x6755',bytes(65536))

    def test_safe_stack_contract_must_not_be_bypassed(self):
        f=candidate_622c()
        f['instructions'][0]['pcode'][1]['inputs'][1]=vn('register',18,2)
        with self.assertRaisesRegex(Unsupported,'Unresolved'):
            audit_sites(f,'0x622c',bytes(65536))

    def test_complete_synthetic_rom_passes_board_build_but_not_pure(self):
        raw,image=synthetic_image_and_raw()
        with tempfile.TemporaryDirectory() as tmp:
            report=build(raw,image,Path(tmp))
            self.assertEqual(report['blocked'],[])
            self.assertEqual(len(report['generated']),2)
            for item in report['generated']:
                self.assertTrue(Path(item['javascript']).exists())
                self.assertEqual(item['board_sites'] and len(item['board_sites']),
                                 len(BOARD_IO[item['entry']]))
                self.assertFalse(item['equivalence_verified'])
            self.assertFalse(report['pure_codegen_eligibility_changed'])
            self.assertFalse(report['hardware_equivalence_verified'])
            # The original pure generation contract MUST stay fail-closed.
            from guarded_codegen import build as pure_build
            pure=pure_build(raw,image,folder / 'pure',['0x622c','0x6755'])
            self.assertEqual(len(pure['generated']),0)
            self.assertEqual(len(pure['blocked']),2)
            self.assertTrue(all('mmio-forbidden' in x['reason']
                                for x in pure['blocked']))

    def test_no_uninstrumented_generated_output(self):
        with self.assertRaisesRegex(Unsupported,'anchor'):
            board_source('export function nope() {}','0x622c')

    def test_unknown_entry_is_rejected(self):
        with self.assertRaisesRegex(Unsupported,'approved entry'):
            board_source('bad code','0x9000')


@unittest.skipUnless(shutil.which('node'),'Node required')
class BoardExecutionTests(unittest.TestCase):
    def emit_and_run(self,func,entry,assertions):
        ir=normalize_function(func)
        js=board_source(guard_source(compile_function(ir)),entry)
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)
            (d/'board.mjs').write_text(js)
            (d/'check.mjs').write_text(
                "import {runRoutine} from './board.mjs';\n"+
                "import assert from 'node:assert/strict';\n"+assertions)
            result=subprocess.run(['node',str(d/'check.mjs')],
                                  capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stderr)

    def test_injected_dip_reads_and_exact_trace(self):
        self.emit_and_run(candidate_622c(),'0x622c',"""
const memory=new Uint8Array(65536),registers=new Uint8Array(256);
registers[24]=2;registers[25]=0;memory[0x40]=0x31;
const ioReads=[{addr:0x3003,size:1,value:0x12},
               {addr:0x3004,size:1,value:0x34}];
const got=runRoutine(memory,registers,20,ioReads);
assert.equal(got.pc,0x6238);
assert.equal(got.registers[0],0x12);
assert.equal(got.registers[1],0x34);
assert.deepEqual(got.ioTrace,[
 {kind:'read',pc:0x622c,addr:0x3003,size:1,value:0x12},
 {kind:'read',pc:0x6232,addr:0x3004,size:1,value:0x34}]);
assert.equal(registers[0],0);assert.equal(memory[0x3003],0);
assert.equal(ioReads[0].value,0x12);
assert.notStrictEqual(got.memory,memory);
""")

    def test_exact_video_control_write_trace(self):
        self.emit_and_run(candidate_6755(),'0x6755',"""
const memory=new Uint8Array(65536),registers=new Uint8Array(256);
registers[24]=2;
for(let i=0;i<5;i++)memory[0x40+i]=0xa1+i;
const got=runRoutine(memory,registers,20,[]);
assert.equal(got.pc,0x6771);
assert.deepEqual(got.ioTrace,[
 {kind:'write',pc:0x6759,addr:0x3d00,size:1,value:0xa1},
 {kind:'write',pc:0x675e,addr:0x3b09,size:1,value:0xa2},
 {kind:'write',pc:0x6761,addr:0x3b08,size:1,value:0xa3},
 {kind:'write',pc:0x676b,addr:0x3b0b,size:1,value:0xa4},
 {kind:'write',pc:0x676e,addr:0x3b0a,size:1,value:0xa5}]);
assert.equal(got.memory[0x3d00],0);
assert.equal(got.memory[0x3b09],0);
assert.equal(memory[0x40],0xa1);
assert.equal(registers[0],0);
""")

    def test_wrong_input_order_or_port_is_rejected(self):
        self.emit_and_run(candidate_622c(),'0x622c',"""
const m=new Uint8Array(65536),r=new Uint8Array(256);r[24]=2;
assert.throws(()=>runRoutine(m,r,20,[]),/Exact approved board reads/);
assert.throws(()=>runRoutine(m,r,20,[
 {addr:0x3004,size:1,value:4},{addr:0x3003,size:1,value:5}
]),/Invalid\\/unapproved board read input/);
assert.throws(()=>runRoutine(m,r,20,[
 {addr:0x3003,size:1,value:256},{addr:0x3004,size:1,value:5}
]),/Invalid\\/unapproved board read input/);
assert.throws(()=>runRoutine(m,r,20,[
 {addr:0x3003,size:1,value:4,extra:true},{addr:0x3004,size:1,value:5}
]),/Invalid\\/unapproved board read input/);
""")

    def test_missing_dp_s_cannot_mutate_input(self):
        self.emit_and_run(candidate_6755(),'0x6755',"""
const m=new Uint8Array(65536),r=new Uint8Array(256);
r[9]=1;r[24]=2;m[0x40]=0xaa;
assert.throws(()=>runRoutine(m,r,20,[]),/DP\\/S contract/);
assert.equal(m[0x40],0xaa);assert.equal(m[0x3d00],0);
""")


    def test_runtime_forbids_new_mmio_write_even_in_board_mode(self):
        f=candidate_6755()
        f['instructions'][3]['pcode'].append(op_write(0x3b0f,0))
        self.emit_and_run(f,'0x6755',"""
const m=new Uint8Array(65536),r=new Uint8Array(256);r[24]=2;
assert.throws(()=>runRoutine(m,r,20,[]),/Unapproved board MMIO/);
assert.equal(m[0x3b0f],0);
""")

    def test_runtime_forbids_rom_write(self):
        f=candidate_6755()
        f['instructions'][0]['pcode'].insert(0,op_write(0x6000,0))
        self.emit_and_run(f,'0x6755',"""
const m=new Uint8Array(65536),r=new Uint8Array(256);r[24]=2;
assert.throws(()=>runRoutine(m,r,20,[]),/ROM write forbidden/);
assert.equal(m[0x6000],0);
""")

    def test_runtime_forbids_ram_mmio_cross_boundary(self):
        f=candidate_6755()
        f['instructions'][0]['pcode'].insert(0,{
            'op':'STORE','space_name':'RAM','inputs':[
              vn('const',1,8),vn('const',0x2fff,2),vn('register',18,2)],
            'output':None})
        self.emit_and_run(f,'0x6755',"""
const m=new Uint8Array(65536),r=new Uint8Array(256);r[24]=2;
assert.throws(()=>runRoutine(m,r,20,[]),/straddles board boundary/);
assert.equal(m[0x2fff],0);
""")

    def test_unapproved_runtime_mmio_access_is_rejected(self):
        f=candidate_622c()
        f['instructions'][0]['pcode'].append(op_read(0x3005,5))
        self.emit_and_run(f,'0x622c',"""
const m=new Uint8Array(65536),r=new Uint8Array(256);r[24]=2;
assert.throws(()=>runRoutine(m,r,20,[
 {addr:0x3003,size:1,value:1},{addr:0x3004,size:1,value:2}
]),/Unapproved board MMIO/);
""")

if __name__=='__main__': unittest.main()

@unittest.skipUnless(shutil.which('node'),'Node required')
class BoardHarnessIntegrationTests(unittest.TestCase):
    def test_synthetic_end_to_end_manifest_and_replay(self):
        raw,image=synthetic_image_and_raw()
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            manifest=build(raw,image,folder)
            self.assertEqual(manifest['blocked'],[])
            filename=folder/'report.json'
            filename.write_text(json.dumps(manifest))
            script=Path(__file__).resolve().parents[1]/'scripts/verify-board-functions.mjs'
            result=subprocess.run(['node',str(script),str(filename)],
                capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
            report=json.loads((folder/'verification-report.json').read_text())
            self.assertEqual(report['status'],'PASS_BOARD_JS_ONLY')
            self.assertFalse(report['equivalence_verified'])
            self.assertFalse(report['hardware_behavior_verified'])
            self.assertFalse(report['entry_invariants_proven'])
            self.assertEqual([len(x['accepted']) for x in report['routines']],[3,3])
            self.assertEqual([len(x['rejected']) for x in report['routines']],[3,3])
            self.assertEqual(len(report['routines'][0]['accepted'][0]['ioTrace']),2)
            self.assertEqual(len(report['routines'][1]['accepted'][0]['ioTrace']),5)

    def test_changed_artifact_digest_fails_closed(self):
        raw,image=synthetic_image_and_raw()
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            manifest=build(raw,image,folder)
            filename=folder/'report.json'
            filename.write_text(json.dumps(manifest))
            Path(manifest['generated'][0]['javascript']).write_text('tampered module')
            script=Path(__file__).resolve().parents[1]/'scripts/verify-board-functions.mjs'
            result=subprocess.run(['node',str(script),str(filename)],
                capture_output=True,text=True,timeout=30)
            self.assertNotEqual(result.returncode,0)
            report=json.loads((folder/'verification-report.json').read_text())
            self.assertEqual(report['status'],'FAILED')
            self.assertIn('digest mismatch',report['failures'][0]['reason'])

