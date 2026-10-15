#!/usr/bin/env python3
"""ROM-authenticated *experimental* P-code -> JS with explicit board I/O trace.

This does NOT emulate 6809 hardware or certify equivalent CPU behavior.
Pure guarded generation remains blocked for either routine. Board mode
accepts only seven known MMIO data sites (including instruction PC,
direction, byte width and address), with injected reads and captured
ordered writes. Unknown MMIO/ROM writes fail closed.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from function_inventory import verify_raw
from function_ir import normalize_function
from guarded_codegen import guard_source, missing_known_io_sites, CONTRACT_NAME
from memory_contracts import evaluate
from pcode_codegen import compile_function, Unsupported

# Exactly the seven sites reported in the real Ghidra/ROM export.
# These are byte-level I/O effects, not asserted device semantics.
BOARD_IO = {
    '0x622c': (
        (0x622c, 'LOAD', 0x3003, 1),
        (0x6232, 'LOAD', 0x3004, 1),
    ),
    '0x6755': (
        (0x6759, 'STORE', 0x3d00, 1),
        (0x675e, 'STORE', 0x3b09, 1),
        (0x6761, 'STORE', 0x3b08, 1),
        (0x676b, 'STORE', 0x3b0b, 1),
        (0x676e, 'STORE', 0x3b0a, 1),
    ),
}
EXPECTED_SAFE = {'0x622c': 3, '0x6755': 5}
EXPECTED_TOTAL = {'0x622c': 5, '0x6755': 10}
SCHEMA = 'gng.board-pcode-experiment.v1'

def audit_sites(func: dict, entry: str, image: bytes) -> dict:
    obligations = evaluate(func)
    known_missing = missing_known_io_sites(entry, image, obligations['accesses'])
    if known_missing:
        raise Unsupported('ROM opcode I/O missing in exported P-code: ' +
                          ', '.join(known_missing))
    actual = []
    bad = []
    for item in obligations['accesses']:
        category = item['hypothetical_classification']
        if category == 'mmio-forbidden' and item['access_form'] == 'direct-varnode':
            interval = item['address_interval']
            if interval and interval[0] == interval[1]:
                actual.append((int(item['instruction'], 16),
                               item['operation'], interval[0],
                               item['width_bytes']))
            else:
                bad.append(item)
        elif category not in ('ram-under-hypothesis',
                              'rom-read-under-hypothesis'):
            bad.append(item)
    if bad:
        raise Unsupported('Unresolved/unapproved memory site(s): ' +
                          str([(x['instruction'], x['operation'],
                                x['hypothetical_classification']) for x in bad[:5]]))
    wanted = Counter(BOARD_IO[entry])
    found = Counter(actual)
    if found != wanted:
        raise Unsupported('Board MMIO site mismatch; missing=' +
                          str(list((wanted-found).elements())) +
                          '; unexpected=' + str(list((found-wanted).elements())))
    if (obligations['access_count'] != EXPECTED_TOTAL[entry] or
            obligations['conditionally_in_range'] != EXPECTED_SAFE[entry]):
        raise Unsupported('Changed conditional RAM/stack access contract: ' +
                          str(obligations['conditionally_in_range']) + '/' +
                          str(obligations['access_count']))
    return obligations

CORE_SIGNATURE = 'function runRoutineCore(memory, registers=new Uint8Array(256), maxSteps=10000) {'
WRAPPER_SIGNATURE = 'export function runRoutine(memory, registers=new Uint8Array(256), maxSteps=10000) {'
MEM_READ = """  function memRead(addr,size) {
    assertDpS();
    if (addr<0 || addr+size>65536 || (addr<0x4000 && addr+size>0x3000)) throw new RangeError('I/O read requires hardware adapter');
    let v=0; for(let i=0;i<size;i++) v=v*256+memory[addr+i]; return v;
  }"""
MEM_WRITE = """  function memWrite(addr,size,v) {
    assertDpS();
    if(addr<0 || addr+size>0x3000) throw new RangeError('Pure routine cannot write MMIO or ROM');
    for(let i=size-1;i>=0;i--) {memory[addr+i]=v & 255; v=Math.floor(v/256);}
  }"""
RETURN = 'return { registers, steps, pc, memory };'

def once(source: str, old: str, replacement: str) -> str:
    if source.count(old) != 1:
        raise Unsupported('Board instrumentation anchor absent/ambiguous; blocked: ' +
                          old[:55])
    return source.replace(old, replacement, 1)

def board_source(pure_guarded: str, entry: str) -> str:
    if entry not in BOARD_IO:
        raise Unsupported('Board codegen requires approved entry')
    policy = [{'pc': pc, 'kind': 'read' if op == 'LOAD' else 'write',
               'addr': addr, 'size': size}
              for pc, op, addr, size in BOARD_IO[entry]]
    reads = [x for x in policy if x['kind'] == 'read']
    result = once(pure_guarded, CORE_SIGNATURE,
                  'function runRoutineCore(memory, registers=new Uint8Array(256), maxSteps=10000, ioReads=[]) {')
    result = once(result, WRAPPER_SIGNATURE,
                  'export function runRoutine(memory, registers=new Uint8Array(256), maxSteps=10000, ioReads=[]) {')
    init = (
        '  const ioTrace=[];\n'
        '  let ioReadIndex=0;\n'
        '  const boardSites=' + json.dumps(policy, separators=(',', ':')) + ';\n'
        '  function approvedIO(kind,addr,size) {\n'
        '    if (!boardSites.some(x=>x.pc===pc && x.kind===kind && x.addr===addr && x.size===size))\n'
        "      throw new RangeError('Unapproved board MMIO site or width');\n"
        '  }\n'
        '  function readBoard(addr,size) {\n'
        "    approvedIO('read',addr,size);\n"
        "    if (ioReadIndex>=ioReads.length) throw new RangeError('Missing board input read');\n"
        '    const item=ioReads[ioReadIndex++];\n'
        "    if (item.addr!==addr || item.size!==size) throw new RangeError('Board input read-order mismatch');\n"
        "    ioTrace.push({kind:'read',pc,addr,size,value:item.value});\n"
        '    return item.value;\n'
        '  }\n'
        '  function writeBoard(addr,size,value) {\n'
        "    approvedIO('write',addr,size);\n"
        "    ioTrace.push({kind:'write',pc,addr,size,value:mask(value,size)});\n"
        '  }\n'
    )
    result = once(result, '  const tmp=new Map();', init + '  const tmp=new Map();')
    replacement_read = """  function memRead(addr,size) {
    assertDpS();
    if (!Number.isSafeInteger(addr) || !Number.isSafeInteger(size) ||
        size<1 || size>4 || addr<0 || addr+size>65536)
      throw new RangeError('Memory read outside 6809 address space');
    if (addr<0x3000 && addr+size>0x3000)
      throw new RangeError('Memory read straddles board boundary');
    if (addr>=0x3000 && addr<0x4000) {
      if (addr+size>0x4000) throw new RangeError('Memory read straddles board boundary');
      return readBoard(addr,size);
    }
    let v=0; for(let i=0;i<size;i++) v=v*256+memory[addr+i]; return v;
  }"""
    replacement_write = """  function memWrite(addr,size,v) {
    assertDpS();
    if (!Number.isSafeInteger(addr) || !Number.isSafeInteger(size) ||
        size<1 || size>4 || addr<0 || addr+size>65536)
      throw new RangeError('Memory write outside 6809 address space');
    if (addr<0x3000 && addr+size>0x3000)
      throw new RangeError('Memory write straddles board boundary');
    if (addr>=0x3000 && addr<0x4000) {
      if (addr+size>0x4000) throw new RangeError('Memory write straddles board boundary');
      writeBoard(addr,size,v);
      return;
    }
    if(addr>=0x4000) throw new RangeError('ROM write forbidden');
    for(let i=size-1;i>=0;i--) {memory[addr+i]=v & 255; v=Math.floor(v/256);}
  }"""
    result = once(result, MEM_READ, replacement_read)
    result = once(result, MEM_WRITE, replacement_write)
    if RETURN not in result:
        raise Unsupported('Board return instrumentation anchor absent')
    result = result.replace(RETURN,
        "if (ioReadIndex!==ioReads.length) throw new Error('Unused board input reads'); "
        "return { registers, steps, pc, memory, ioTrace:ioTrace.slice() };")
    wrapper_anchor = '  return runRoutineCore(memory.slice(),registers.slice(),maxSteps);'
    wrapper_replacement = (
        "  if (!Array.isArray(ioReads) || ioReads.length!==" + str(len(reads)) + ")\n"
        "    throw new RangeError('Exact approved board reads required');\n"
        "  const expectedReads=" + json.dumps(reads, separators=(',', ':')) + ";\n"
        "  const readInputs=ioReads.map((x,i)=>{\n"
        "    if (x===null || typeof x!=='object' || Array.isArray(x) ||\n"
        "        !Number.isSafeInteger(x.addr) || !Number.isSafeInteger(x.size) ||\n"
        "        !Number.isSafeInteger(x.value) || x.value<0 ||\n"
        "        x.value>maxSize(x.size) ||\n"
        "        x.addr!==expectedReads[i].addr || x.size!==expectedReads[i].size ||\n"
        "        Object.keys(x).sort().join(',')!=='addr,size,value')\n"
        "      throw new RangeError('Invalid/unapproved board read input');\n"
        "    return {addr:x.addr,size:x.size,value:x.value};\n"
        "  });\n"
        "  return runRoutineCore(memory.slice(),registers.slice(),maxSteps,readInputs);"
    )
    result = once(result, wrapper_anchor, wrapper_replacement)
    return '// BOARD-MMIO EXPERIMENT ONLY. NO 6809 EQUIVALENCE.\n' + result

def build(raw: dict, image: bytes, output_dir: Path, entries=None) -> dict:
    verify_raw(raw, image)
    chosen = list(BOARD_IO) if entries is None else entries
    if not chosen or len(chosen) != len(set(chosen)) or set(chosen) - set(BOARD_IO):
        raise ValueError('Expected unique approved board entries only')
    funcs = {f['entry']: f for f in raw['functions']}
    report = {
        'schema': SCHEMA, 'contract': CONTRACT_NAME,
        'status': 'EXPERIMENTAL_BOARD_IO_NO_6809_REFERENCE',
        'pure_codegen_eligibility_changed': False,
        'hardware_equivalence_verified': False,
        'generated': [], 'blocked': [],
    }
    for entry in chosen:
        func = funcs.get(entry)
        if func is None:
            report['blocked'].append({'entry': entry, 'reason': 'Not exported by Ghidra'})
            continue
        try:
            obligations = audit_sites(func,entry,image)
            ir = normalize_function(func)
            guarded = guard_source(compile_function(ir))
            js = board_source(guarded,entry)
        except (Unsupported, ValueError, KeyError, TypeError, IndexError) as exc:
            report['blocked'].append({'entry': entry, 'reason': str(exc)})
            continue
        output_dir.mkdir(parents=True,exist_ok=True)
        file = output_dir / ('board_' + entry[2:] + '.mjs')
        file.write_text(js)
        report['generated'].append({
            'entry': entry, 'javascript': str(file),
            'sha256': hashlib.sha256(js.encode()).hexdigest(),
            'conditional_ram_accesses': obligations['conditionally_in_range'],
            'all_memory_accesses': obligations['access_count'],
            'board_sites': [{'pc':pc,'kind':'read' if op=='LOAD' else 'write',
                             'addr':addr,'size':size}
                            for pc,op,addr,size in BOARD_IO[entry]],
            'runtime_dp_s_guards':True,
            'io_trace_captured':True,
            'input_state_copied':True,
            'equivalence_verified':False,
        })
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=Path('out/functions.raw.json'))
    parser.add_argument('--rom-image',type=Path,default=Path('out/gngb-flat.bin'))
    parser.add_argument('--out',type=Path,default=Path('out/generated-board'))
    parser.add_argument('--entries',nargs='*',default=list(BOARD_IO))
    args=parser.parse_args()
    result=build(json.loads(args.input.read_text()),
                 args.rom_image.read_bytes(),args.out,args.entries)
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/'report.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    print('GNG_BOARD_CODEGEN='+('EXPERIMENTAL' if result['generated'] else 'BLOCKED')+
          ' generated='+str(len(result['generated']))+
          ' blocked='+str(len(result['blocked'])))
    for entry in result['generated']:
        print('  '+entry['entry']+' board='+entry['javascript']+' equivalence=UNVERIFIED')
    for entry in result['blocked']:
        print('  '+entry['entry']+' BLOCKED '+entry['reason'])
    print('GNG_T2B_ACCEPTANCE=NOT_ESTABLISHED no independent 6809 CPU reference')

if __name__=='__main__':
    main()
