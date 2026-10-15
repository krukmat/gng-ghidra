"""Fail-closed indexed 6809 P-code contract, using ROM-free synthetic exports."""
from __future__ import annotations
import copy
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from function_inventory import rom_vectors
from indexed_codegen import ENTRY, SCHEMA, validate, build, instrument, INDEX_LOW, INDEX_HIGH
from pcode_codegen import Unsupported
from test_board_codegen import synthetic_image_and_raw, raw_routine, vn
from test_third_routine_candidates import modeled_rts_ops
from third_routine_candidates import rank


def sample():
    raw,image=synthetic_image_and_raw()
    # 9 absolute RAM reads + 2 X-index reads + 1 stack-popping RTS
    # = 12 memory sites; 10 conditional DP/S or absolute-safe, 2 indexed.
    direct=[
        {'op':'COPY','inputs':[vn('RAM',0x40+i,1)],
         'output':vn('unique',0x100+i,1)}
        for i in range(9)
    ]
    indexed=[
        {'op':'LOAD','space_name':'RAM','inputs':[
            vn('const',1,8),vn('register',18,2)],
         'output':vn('unique',0x200+i,1)}
        for i in range(2)
    ]
    function=raw_routine(0x6239,[
        (0x6239,direct),
        (0x623a,indexed),
        (0x623b,modeled_rts_ops()),
    ])
    data=bytearray(image)
    for ins in function['instructions']:
        data[int(ins['address'],16)]=0x39
    raw=copy.deepcopy(raw)
    raw['functions'].append(function)
    raw['vectors']=rom_vectors(bytes(data))
    return raw,bytes(data)


class IndexedCodegenTests(unittest.TestCase):
    def test_detect_two_index_x_accesses_from_actual_pcode_shape(self):
        raw,image=sample()
        proof=validate(raw,image)
        self.assertEqual(proof['registers'],['X'])
        self.assertEqual(len(proof['indexed']),2)
        self.assertEqual(proof['memory_total'],12)
        self.assertEqual(proof['conditionally_bounded'],10)
        self.assertEqual(proof['return_instruction'],'0x623b')
        self.assertEqual(rank(raw,image)['candidates'][0]['entry'],'0x6239')

    def test_build_hash_and_approval_do_not_pretend_equivalence(self):
        raw,image=sample()
        with tempfile.TemporaryDirectory() as tmp:
            report=build(raw,image,Path(tmp))
            self.assertEqual(report['status'],
                             'EXPERIMENTAL_INDEXED_JS_NOT_NATIVE_EQUIVALENCE')
            self.assertEqual(report['schema'],SCHEMA)
            self.assertEqual(report['blocked'],[])
            self.assertEqual(len(report['generated']),1)
            self.assertEqual(report['rom_sha256'],hashlib.sha256(image).hexdigest())
            item=report['generated'][0]
            self.assertEqual(item['index_registers'],['X'])
            self.assertEqual(item['memory_sites'],12)
            self.assertFalse(item['native_equivalence_verified'])
            self.assertFalse(report['actual_game_entry_conditions_proven'])
            self.assertFalse(report['pure_unconditional_codegen_eligibility_changed'])
            js=Path(item['javascript']).read_text()
            self.assertEqual(item['sha256'],hashlib.sha256(js.encode()).hexdigest())
            self.assertEqual(js.count('assertDpS(); assertIndex();'),3)

    def test_mismatch_genuine_rom_blocks(self):
        raw,image=sample()
        damaged=bytearray(image)
        damaged[0x6239]=0x42
        with tempfile.TemporaryDirectory() as tmp:
            report=build(raw,bytes(damaged),Path(tmp))
        self.assertEqual(report['generated'],[])
        self.assertIn('ROM bytes differ',report['blocked'][0]['reason'])

    def test_unknown_non_index_pointer_blocks(self):
        raw,image=sample()
        raw['functions'][-1]['instructions'][1]['pcode'][0]['inputs'][1]=vn('register',5,2)
        with tempfile.TemporaryDirectory() as tmp:
            report=build(raw,image,Path(tmp))
        self.assertEqual(report['generated'],[])
        self.assertIn('not exclusively X/Y/U',report['blocked'][0]['reason'])

    def test_change_index_access_count_blocks(self):
        raw,image=sample()
        raw['functions'][-1]['instructions'][1]['pcode'].pop()
        with tempfile.TemporaryDirectory() as tmp:
            report=build(raw,image,Path(tmp))
        self.assertEqual(report['generated'],[])
        self.assertIn('memory obligations',report['blocked'][0]['reason'])

    def test_add_unknown_mmio_blocks(self):
        raw,image=sample()
        raw['functions'][-1]['instructions'][0]['pcode'][0]['inputs'][0]=vn('RAM',0x3b08,1)
        with tempfile.TemporaryDirectory() as tmp:
            report=build(raw,image,Path(tmp))
        self.assertEqual(report['generated'],[])
        self.assertIn('unsafe',report['blocked'][0]['reason'].lower())

    def test_missing_index_runtime_guard_fails_closed(self):
        with self.assertRaisesRegex(Unsupported,'anchor'):
            instrument('arbitrary code',['X'])

    def test_unapproved_index_register_rejected(self):
        with self.assertRaisesRegex(Unsupported,'Unsupported index'):
            instrument('anything',['DP'])


@unittest.skipUnless(shutil.which('node'),'Node runtime required')
class IndexedJsExecutionTests(unittest.TestCase):
    def test_synthetic_x_access_and_runtime_contract_guards(self):
        raw,image=sample()
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            report=build(raw,image,directory)
            self.assertEqual(report['blocked'],[])
            harness=directory/'harness.mjs'
            harness.write_text("""
import {runRoutine} from './indexed_6239.mjs';
import assert from 'node:assert/strict';
const mem=new Uint8Array(65536),regs=new Uint8Array(256);
regs[24]=0x10;regs[25]=0; // S=0x1000
regs[18]=2;regs[19]=0; // X=0x0200
mem[0x1000]=0x70;mem[0x1001]=0;
mem[0x200]=0x24;
const result=runRoutine(mem,regs,20);
assert.equal(result.pc,0x623b);
assert.equal(result.steps,3);
assert.equal((result.registers[24]<<8)|result.registers[25],0x1002);
assert.equal(result.memory[0x200],0x24);
assert.equal(mem[0x200],0x24);
assert.equal(regs[25],0);
regs[18]=0x30;regs[19]=0;
assert.throws(()=>runRoutine(mem,regs,20),/index X contract/);
regs[18]=0;regs[19]=0;
assert.throws(()=>runRoutine(mem,regs,20),/index X contract/);
regs[18]=2;regs[19]=0;regs[9]=1;
assert.throws(()=>runRoutine(mem,regs,20),/DP\\/S contract/);
""")
            run=subprocess.run(['node',str(harness)],capture_output=True,text=True,timeout=15)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr)


if __name__ == '__main__':
    unittest.main()
