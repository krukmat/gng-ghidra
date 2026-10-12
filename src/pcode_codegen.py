"""Emit standalone JS/TS from eligible typed raw Ghidra P-code.

P-code is compiled to statements, not interpreted from a data table at runtime.
Unsupported semantics fail closed. Only isolated, bounded routines are eligible.
All register offsets use a byte-addressed big-endian storage to retain aliases.
"""
from __future__ import annotations
import json
from pathlib import Path
from function_ir import integer

ALU = {'INT_ADD': 'a + b', 'INT_SUB': 'a - b', 'INT_MULT': 'Math.imul(a,b)',
       'INT_AND': 'a & b', 'INT_OR': 'a | b', 'INT_XOR': 'a ^ b',
       'INT_LEFT': 'a << b', 'INT_RIGHT': 'a >>> b',
       'INT_EQUAL': 'Number(a === b)', 'INT_NOTEQUAL': 'Number(a !== b)',
       'INT_LESS': 'Number(a < b)', 'INT_LESSEQUAL': 'Number(a <= b)',
       'INT_CARRY': 'Number(a + b > maxSize(sa))',
       'INT_SLESS': 'Number(signed(a, sa) < signed(b, sb))',
       'INT_SLESSEQUAL': 'Number(signed(a, sa) <= signed(b, sb))',
       'BOOL_AND': 'Number(Boolean(a) && Boolean(b))',
       'BOOL_OR': 'Number(Boolean(a) || Boolean(b))',
       'BOOL_XOR': 'Number(Boolean(a) !== Boolean(b))',
       'INT_SCARRY': 'Number(signed(a, sa) + signed(b, sb) !== signed(a + b, sa))',
       'INT_SBORROW': 'Number(signed(a, sa) - signed(b, sb) !== signed(a - b, sa))'}
UNARY = {'COPY': 'a', 'INT_ZEXT': 'a', 'INT_SEXT': 'signed(a, sa)',
         'INT_NEGATE': '~a', 'INT_2COMP': '-a', 'BOOL_NEGATE': 'Number(!a)',
         'INT_SRIGHT': 'signed(a, sa) >> b'}

class Unsupported(ValueError):
    pass

def var(v):
    return f'{{space:{json.dumps(v["space"])},offset:{integer(v["offset"])},size:{v["size"]}}}'

def emission(p):
    op = p['op']
    ins = p['inputs']
    out = p['output']
    if any(x['size'] > 4 for x in ins + ([out] if out else [])):
        raise Unsupported(f'{op}: >32-bit P-code not yet supported')
    if any(x['space'] not in ('const', 'register', 'unique', 'ram') for x in ins + ([out] if out else [])):
        raise Unsupported(f'{op}: unsupported address space')
    if op in ALU or op in UNARY:
        expected = 2 if op in ALU or op == 'INT_SRIGHT' else 1
        if out is None or len(ins) != expected:
            raise Unsupported(f'{op}: invalid operand count')
        a = var(ins[0])
        b = var(ins[1]) if expected == 2 else None
        expression = ALU.get(op, UNARY.get(op))
        expression_vars = f'const vb={b}, b=rd(vb), sb=vb.size;' if b is not None else 'const b=0, sb=0;'
        return f'{{ const va={a}, a=rd(va), sa=va.size, sz={out["size"]}; {expression_vars} wr({var(out)}, mask({expression}, sz)); }}'
    if op == 'PIECE':
        if len(ins) != 2 or out is None:
            raise Unsupported('PIECE: invalid arity')
        return f'wr({var(out)}, rd({var(ins[0])}) * (2 ** {8*ins[1]["size"]}) + rd({var(ins[1])}));'
    if op == 'SUBPIECE':
        if len(ins) != 2 or out is None or ins[1]['space'] != 'const':
            raise Unsupported('SUBPIECE: invalid arity')
        return f'wr({var(out)}, Math.floor(rd({var(ins[0])}) / (2 ** (8*{integer(ins[1]["offset"])}))));'
    if op in ('LOAD', 'STORE'):
        if (op == 'LOAD' and (out is None or len(ins) != 2)) or (op == 'STORE' and len(ins) != 3):
            raise Unsupported(f'{op}: invalid arity')
        if ins[0]['space'] != 'const':
            raise Unsupported(f'{op}: dynamic address-space identifier')
        # Ghidra's space-id is not a byte address; only default RAM is supported.
        # The compiler checks raw Ghidra exported space_name from the exporter.
        space_name = p.get('space_name')
        if space_name != 'ram':
            raise Unsupported(f'{op}: unknown memory space {space_name!r}')
        if op == 'LOAD':
            return f'wr({var(out)}, memRead(rd({var(ins[1])}), {out["size"]}));'
        return f'memWrite(rd({var(ins[1])}), {ins[2]["size"]}, rd({var(ins[2])}));'
    if op == 'BRANCH':
        if len(ins) != 1 or ins[0]['space'] != 'ram':
            raise Unsupported('BRANCH: target not a direct code address')
        return f'pc = {integer(ins[0]["offset"])}; jumped = true; break micro;'
    if op == 'CBRANCH':
        if len(ins) != 2 or ins[0]['space'] != 'ram':
            raise Unsupported('CBRANCH: target not a direct code address')
        return f'if (rd({var(ins[1])}) !== 0) {{ pc = {integer(ins[0]["offset"])}; jumped = true; break micro; }}'
    if op == 'RETURN':
        # An isolated function boundary; does NOT model returning to external caller.
        if len(ins) != 1:
            raise Unsupported('RETURN: indirect or malformed return')
        return 'return { registers, steps, pc, memory };'
    if op in ('CALL', 'CALLIND', 'BRANCHIND', 'CALLOTHER', 'MULTIEQUAL', 'INDIRECT'):
        raise Unsupported(f'{op}: requires interprocedural / hardware model')
    raise Unsupported(f'Unsupported P-code opcode {op}')

HEADER = '''// Generated from Ghidra instruction P-code. No 6809 CPU emulator or ROM assets.
// Fail-closed subset; do not edit manually.
function maxSize(size) { return size === 4 ? 0xffffffff : (2 ** (8*size) - 1); }
function mask(value,size) { return size===4 ? (value>>>0) : (value & maxSize(size)); }
function signed(value,size) { const bits=8*size; return bits===32 ? (value | 0) : (value << (32-bits)) >> (32-bits); }
export function runRoutine(memory, registers=new Uint8Array(256), maxSteps=10000) {
  if (!(memory instanceof Uint8Array) || memory.length !== 65536) throw new RangeError('64 KiB memory required');
  if (!(registers instanceof Uint8Array) || registers.length !== 256) throw new RangeError('256-byte register file required');
  if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new RangeError('positive step budget required');
  const tmp=new Map();
  function rd(n) {
    if (n.space==='const') return mask(n.offset,n.size);
    if (n.space==='unique') { const k=n.offset+':'+n.size; if (!tmp.has(k)) throw new Error('Undefined P-code temporary '+k); return tmp.get(k); }
    if (n.space==='ram') throw new Error('Direct RAM varnode read not implemented; use LOAD');
    if (n.space!=='register' || n.offset+n.size>registers.length) throw new Error('Invalid register read');
    let v=0; for (let i=0;i<n.size;i++) v=(v*256)+registers[n.offset+i]; return v;
  }
  function wr(n,v) {
    v=mask(v,n.size);
    if (n.space==='unique') { tmp.set(n.offset+':'+n.size,v); return; }
    if (n.space!=='register' || n.offset+n.size>registers.length) throw new Error('Invalid register write');
    for(let i=n.size-1;i>=0;i--) { registers[n.offset+i]=v & 255; v=Math.floor(v/256); }
  }
  function memRead(addr,size) {
    if (addr<0 || addr+size>65536 || (addr<0x4000 && addr+size>0x3000)) throw new RangeError('I/O read requires hardware adapter');
    let v=0; for(let i=0;i<size;i++) v=v*256+memory[addr+i]; return v;
  }
  function memWrite(addr,size,v) {
    if(addr<0 || addr+size>0x3000) throw new RangeError('Pure routine cannot write MMIO or ROM');
    for(let i=size-1;i>=0;i--) {memory[addr+i]=v & 255; v=Math.floor(v/256);}
  }
  let pc=ENTRY; let steps=0;
  while(true) {
    if (++steps>maxSteps) throw new Error('Instruction budget exceeded');
    switch(pc) {
CASES
      default: throw new Error('Control flow escaped compiled function at 0x'+pc.toString(16));
    }
  }
}
'''

def compile_function(func: dict) -> str:
    if func['bank_context'] != 'bank4':
        raise Unsupported('Unknown ROM bank context')
    if func.get('truncated'):
        raise Unsupported('Partial CFG: instruction budget exceeded')
    if func['external_edges']:
        raise Unsupported('External edges (call, tail jump or unknown fallthrough): ' + str(func['external_edges'][:3]))
    inst = [item for b in func['blocks'] for item in b['instructions']]
    pcs = {integer(item['address']) for item in inst}
    cases = []
    for item in inst:
        if not item['pcode'] and item.get('pcode_status') != 'verified-nop':
            raise Unsupported(f"Unmodeled instruction {item['address']} ({item['assembly']}): {item.get('pcode_status')}")
        pc = integer(item['address'])
        # For a branch to another routine or non-instruction, refuse compiling.
        for p in item['pcode']:
            if p['op'] in ('BRANCH', 'CBRANCH'):
                target = integer(p['inputs'][0]['offset']) if p['inputs'] else -1
                if target not in pcs: raise Unsupported(f'Unresolved branch 0x{pc:x} -> 0x{target:x}')
        opcodes = '\n'.join('          ' + emission(p) for p in item['pcode'])
        fall = item['fallthrough']
        if fall is None: fall = pc + len(bytes.fromhex(item['raw']))
        case = f'''      case {pc}: {{
        let jumped=false;
        micro: {{
{opcodes}
        }}
        if (!jumped) pc={fall};
        break;
      }}'''
        cases.append(case)
    return HEADER.replace('ENTRY', str(integer(func['entry']))).replace('CASES', '\n'.join(cases))

def compile_bundle(bundle: dict, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    report = {'generated': [], 'blocked': []}
    for f in bundle['functions']:
        entry = f['entry']
        try:
            js = compile_function(f)
            filename = 'routine_' + entry[2:].lower() + '.mjs'
            (output_dir/filename).write_text(js)
            # TS is explicitly typed rather than relying on permissive JS inference.
            typed = js.replace('function maxSize(size)', 'function maxSize(size: number)')\
                .replace('function mask(value,size)', 'function mask(value: number,size: number)')\
                .replace('function signed(value,size)', 'function signed(value: number,size: number)')\
                .replace('runRoutine(memory, registers=new Uint8Array(256), maxSteps=10000)',\
                         'runRoutine(memory: Uint8Array, registers: Uint8Array=new Uint8Array(256), maxSteps: number=10000)')\
                .replace('const tmp=new Map();', 'const tmp=new Map<string, number>();')\
                .replace('return tmp.get(k);', 'return tmp.get(k)!;')\
                .replace('function rd(n)', 'function rd(n: {space:string; offset:number; size:number})')\
                .replace('function wr(n,v)', 'function wr(n: {space:string; offset:number; size:number}, v: number)')\
                .replace('function memRead(addr,size)', 'function memRead(addr: number, size: number)')\
                .replace('function memWrite(addr,size,v)', 'function memWrite(addr: number, size: number, v: number)')
            tsfile = 'routine_' + entry[2:].lower() + '.ts'
            (output_dir/tsfile).write_text(typed)
            report['generated'].append({'entry': entry, 'javascript': str(output_dir/filename),
                                         'typescript': str(output_dir/tsfile)})
        except Unsupported as e:
            report['blocked'].append({'entry': entry, 'reason': str(e)})
    return report