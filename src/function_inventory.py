#!/usr/bin/env python3
"""T2.B.6/7: ROM-authenticated 6809 entry inventory and conservative function triage.

Sources: CPU exception vectors and Ghidra-decoded direct CALL edges, not raw
opcode scans. Exported bytes must match a ROM image from the verified set.
Does not claim a discovered candidate has been behaviorally translated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from pcode_codegen import ALU, UNARY

CPU = '6809:BE:16:default'
SCHEMA = 'gng.function-inventory.v1'
VECTORS = (
    ('SWI3', 0xfff2), ('SWI2', 0xfff4), ('FIRQ', 0xfff6),
    ('IRQ', 0xfff8), ('SWI', 0xfffa), ('NMI', 0xfffc), ('RESET', 0xfffe),
)
MAX_INSTRUCTIONS = 2500


def hx(n: int) -> str:
    return f'0x{n:04x}'


def address(value: str) -> int:
    if not isinstance(value, str) or not value.lower().startswith('0x'):
        raise ValueError(f'Expected hexadecimal address, found {value!r}')
    x = int(value, 16)
    if not 0 <= x <= 0xffff:
        raise ValueError(f'Address outside 16-bit CPU: {value}')
    return x


def mapped_entry(addr: int) -> bool:
    # One snapshotted view: bank4 in 4000-5fff, fixed ROM at 6000-ffff.
    return 0x4000 <= addr < 0xffff


def rom_vectors(image: bytes) -> list[dict]:
    if len(image) != 0x10000:
        raise ValueError('Expected 64-KiB flat ROM image')
    result = []
    for name, loc in VECTORS:
        dest = int.from_bytes(image[loc:loc + 2], 'big')
        # 0xffff is a sentinel for this ROM set, not a valid instruction start.
        mapped = mapped_entry(dest)
        result.append({'name': name, 'vector_address': hx(loc), 'target': hx(dest),
                       'status': 'mapped' if mapped else 'unmapped-or-sentinel'})
    return result


def direct_call_records(function: dict) -> list[dict]:
    entry = address(function['entry'])
    calls = []
    for ins in function['instructions']:
        # Derive CALL from Ghidra's decoded flow classification, never scan
        # an arbitrary byte sequence for the 0xBD/0x8D opcodes.
        flowtype = ins.get('flow_type', '').upper()
        if 'CALL' not in flowtype:
            continue
        for dest in ins.get('flows', []):
            target = address(dest)
            if mapped_entry(target):
                calls.append({'caller_entry': hx(entry), 'call_site': hx(address(ins['address'])),
                              'target': hx(target), 'source': 'ghidra-direct-call'})
    return calls


def valid_code_op(op: str) -> bool:
    return op in ALU or op in UNARY or op in {
        'PIECE', 'SUBPIECE', 'LOAD', 'STORE', 'BRANCH', 'CBRANCH', 'RETURN'
    }


def verify_raw(raw: dict, image: bytes) -> None:
    if raw.get('schema') != 'gng.ghidra-functions.v1' or raw.get('processor') != CPU:
        raise ValueError('Incorrect Ghidra export schema or CPU')
    if raw.get('bank_context') != 'bank4':
        raise ValueError('Unknown ROM bank context')
    if len(image) != 65536:
        raise ValueError('Flat image must contain exactly 65536 bytes')
    vectors = rom_vectors(image)
    if next(v['target'] for v in vectors if v['name'] == 'RESET') != '0x6000':
        raise ValueError('Unexpected reset vector; this pipeline only supports verified gngb')
    ghidra_vectors = raw.get('vectors')
    if ghidra_vectors is not None:
        if not isinstance(ghidra_vectors, list):
            raise ValueError('Ghidra vectors must be an array')
        for got, expected in zip(ghidra_vectors, vectors, strict=True):
            if got != expected:
                raise ValueError(f'Ghidra/ROM vector mismatch: {got!r} != {expected!r}')
    seen_entries = set()
    decoded_anchors = {address(ins['address']): ins
                       for fun in raw['functions'] for ins in fun['instructions']}
    for rec in raw.get('anchored_verified_calls', []):
        if (rec.get('source') != 'ghidra-anchored-jsr'
                or rec.get('ghidra_decoded') is not True
                or rec.get('return_semantics_verified') is not False):
            raise ValueError('Invalid anchored JSR confirmation')
        resolution = rec.get('target_resolution')
        if resolution not in ('ghidra-default-flow', '6809-jsr-extended-operand'):
            raise ValueError('Missing or unsupported JSR target resolution')
        if resolution == '6809-jsr-extended-operand' and (
                rec.get('ghidra_flow_type') != 'COMPUTED_CALL'
                or rec.get('target_from_isa_encoding') is not True):
            raise ValueError('Invalid computed JSR target provenance')
        anchor = address(rec['anchor_call_site'])
        site = address(rec['call_site'])
        dest = address(rec['target'])
        origin = decoded_anchors.get(anchor)
        if origin is None or 'CALL' not in origin.get('flow_type', '').upper():
            raise ValueError(f'No decoded CALL anchor for JSR at {hx(site)}')
        after_anchor = anchor + len(bytes.fromhex(origin['raw']))
        if site < after_anchor or (site - after_anchor) % 3 != 0:
            raise ValueError(f'Unaligned anchored JSR at {hx(site)}')
        if site + 3 > len(image) or image[site] != 0xbd or not mapped_entry(dest):
            raise ValueError(f'Invalid JSR encoding at {hx(site)}')
        if dest != int.from_bytes(image[site + 1:site + 3], 'big'):
            raise ValueError(f'Anchored JSR target mismatch at {hx(site)}')
    seen_entries = set()
    for fun in raw['functions']:
        entry = address(fun['entry'])
        if entry in seen_entries or not mapped_entry(entry):
            raise ValueError(f'Duplicate/invalid exported function entry {hx(entry)}')
        seen_entries.add(entry)
        if fun.get('bank_context') != 'bank4':
            raise ValueError(f'Unexpected function bank at {hx(entry)}')
        instructions = fun['instructions']
        if not instructions or len(instructions) > MAX_INSTRUCTIONS:
            raise ValueError(f'Invalid function length at {hx(entry)}')
        unique = set()
        for ins in instructions:
            pc = address(ins['address'])
            bs = bytes.fromhex(ins['raw'])
            if not bs or len(bs) != ins['length'] or pc + len(bs) > 65536:
                raise ValueError(f'Invalid instruction boundary at {hx(pc)}')
            if pc in unique:
                raise ValueError(f'Duplicate instruction {hx(pc)} in {hx(entry)}')
            unique.add(pc)
            if bs != image[pc:pc + len(bs)]:
                raise ValueError(f'ROM bytes differ from Ghidra at {hx(pc)} (stale or wrong export)')
            # A missing Ghidra fallthrough can be reconstructed *syntactically*
            # for direct CALLs on a 6809, not as evidence the callee returns.
            if ins.get('fallthrough_source') == '6809-call-return-inferred':
                if ('CALL' not in ins.get('flow_type', '').upper()
                        or ins.get('fallthrough') != hx(pc + len(bs))):
                    raise ValueError(f'Invalid inferred call continuation at {hx(pc)}')
        if entry not in unique:
            raise ValueError(f'Function entry {hx(entry)} missing from its own instructions')
        if 'direct_calls' in fun and fun['direct_calls'] != direct_call_records(fun):
            raise ValueError(f'Ghidra direct call metadata mismatch at {hx(entry)}')


def anchored_jsr_probes(raw: dict, image: bytes, max_probes_per_anchor: int = 12) -> list[dict]:
    """Probe a straight JSR-extended byte sequence after a Ghidra-decoded CALL.

    This is NOT CFG recovery or proof the preceding call returns. Starting
    boundaries come solely from a matching Ghidra-decoded CALL; each candidate
    has 6809's fixed three-byte JSR extended encoding (BD addr16).
    """
    if not 1 <= max_probes_per_anchor <= 32:
        raise ValueError('Invalid anchored probe budget')
    decoded_sites = {address(ins['address'])
                     for fun in raw['functions'] for ins in fun['instructions']}
    out = []
    seen_sites = set()
    for fun in raw['functions']:
        for ins in fun['instructions']:
            if 'CALL' not in ins.get('flow_type', '').upper():
                continue
            cursor = address(ins['address']) + len(bytes.fromhex(ins['raw']))
            # Do not reinterpret Ghidra-decoded source instructions or follow
            # long arbitrary raw byte sequences.
            for _ in range(max_probes_per_anchor):
                if cursor in decoded_sites or cursor in seen_sites or cursor + 3 > 0x10000:
                    break
                if image[cursor] != 0xbd:
                    break
                dest = (image[cursor + 1] << 8) | image[cursor + 2]
                if not mapped_entry(dest):
                    break
                seen_sites.add(cursor)
                out.append({'call_site': hx(cursor), 'target': hx(dest),
                            'anchor_call_site': hx(address(ins['address'])),
                            'anchor_entry': fun['entry'],
                            'opcode': 'JSR-extended',
                            'raw': image[cursor:cursor + 3].hex(),
                            'evidence': 'rom-bytes-after-ghidra-call',
                            'execution_proven': False,
                            'ghidra_disassembly_verified': False})
                cursor += 3
    return out


def classify(function: dict, is_interrupt: bool) -> tuple[list[str], dict]:
    insns = function['instructions']
    ops = [p['op'] for ins in insns for p in ins['pcode']]
    calls = direct_call_records(function)
    unknown = [ins for ins in insns if ins.get('pcode_status') not in (None, 'native', 'verified-nop')]
    unsupported_ops = sorted({op for op in ops if not valid_code_op(op)})
    pcs = {address(ins['address']) for ins in insns}
    external_jumps = [ins for ins in insns if 'CALL' not in ins.get('flow_type', '').upper()
                      and any(address(target) not in pcs for target in ins.get('flows', []))]
    memory_ops = [p for ins in insns for p in ins['pcode'] if p['op'] in ('LOAD', 'STORE')]
    non_constant_memory = any(len(p.get('inputs', [])) < 2 or
                              p['inputs'][1]['space'].casefold() != 'const'
                              for p in memory_ops)
    unsafe_static_memory = False
    for p in memory_ops:
        args = p.get('inputs', [])
        if len(args) < 2 or args[1]['space'].casefold() != 'const':
            continue
        ptr = address(args[1]['offset'])
        size = p.get('output', {}).get('size', 1) if p['op'] == 'LOAD' else (
            args[2]['size'] if len(args) > 2 else 1)
        if ptr + size > 0x10000 or 0x3000 <= ptr + size - 1 and ptr < 0x4000:
            unsafe_static_memory = True
        if p['op'] == 'STORE' and ptr + size > 0x3000:
            unsafe_static_memory = True
    # These are decoded 6809 STA/STB extended $3e00 writes to the
    # bank-select register, not a blind opcode scan across ROM bytes.
    # verify_raw() has already checked the disassembly's bytes against ROM.
    bank_select_sites = [ins['address'] for ins in insns
                         if ins['raw'].lower() in ('b73e00', 'f73e00')]
    indirect = any(op in ('BRANCHIND', 'CALLIND') for op in ops)
    return_count = ops.count('RETURN')
    reasons = []
    if is_interrupt:
        reasons.append('interrupt-entry: hardware context must be modeled')
    if function.get('truncated'):
        reasons.append('truncated-control-flow-graph')
    if calls:
        reasons.append('has-direct-callees')
    speculative = [ins['address'] for ins in insns
                   if ins.get('fallthrough_source') == '6809-call-return-inferred']
    if speculative:
        reasons.append('call-return-continuation-unverified')
    if any(op in ('CALL', 'CALLIND') for op in ops) and not calls:
        reasons.append('unresolved-or-indirect-call')
    if indirect:
        reasons.append('indirect-control-flow')
    if bank_select_sites:
        reasons.append('writes-bank-select-register: 0x3e00')
    if any(op == 'CALLOTHER' for op in ops):
        reasons.append('architecture-specific-P-code')
    if unknown:
        reasons.append('unmodeled-instructions')
    if unsupported_ops:
        reasons.append('unsupported-P-code-operators')
    if external_jumps:
        reasons.append('external-direct-jump')
    if memory_ops and non_constant_memory:
        reasons.append('dynamic-memory-address: needs-MMIO-and-bank-proof')
    if unsafe_static_memory:
        reasons.append('static-memory-access-outside-safe-RAM')
    if any(p.get('space_name', 'RAM').casefold() != 'ram' for p in memory_ops):
        reasons.append('nondefault-memory-space')
    if not return_count:
        reasons.append('no-proven-return-boundary')
    # Calls across graph boundaries can be legitimate, but an isolated emitter
    # cannot prove those edges safe until interprocedural modeling is added.
    metrics = {'instruction_count': len(insns), 'direct_call_count': len(calls),
               'unmodeled_instruction_count': len(unknown),
               'memory_operation_count': len(memory_ops),
               'indirect_flow_count': sum(op in ('BRANCHIND', 'CALLIND') for op in ops),
               'return_count': return_count,
               'contains_sync': any(ins.get('pcode_status') == 'unmodeled-wait-for-interrupt'
                                    for ins in insns),
               'unsupported_operators': unsupported_ops,
               'bank_select_write_sites': bank_select_sites,
               'speculative_call_continuation_sites': speculative,
               'external_jump_count': len(external_jumps)}
    return reasons, metrics


def inventory(raw: dict, image: bytes, max_shortlist: int = 3) -> tuple[dict, dict]:
    if not 1 <= max_shortlist <= 12:
        raise ValueError('Invalid selection count')
    verify_raw(raw, image)
    vectors = rom_vectors(image)
    functions = {address(f['entry']): f for f in raw['functions']}
    provenance: dict[int, list[dict]] = {}
    for vec in vectors:
        if vec['status'] == 'mapped':
            provenance.setdefault(address(vec['target']), []).append(
                {'type': 'cpu-vector', 'name': vec['name'], 'source': vec['vector_address']})
    callsites = []
    for fun in raw['functions']:
        callsites += direct_call_records(fun)
    # Keep unverified byte probes separate from Ghidra-confirmed sites.
    probes = anchored_jsr_probes(raw, image)
    confirmed = raw.get('anchored_verified_calls', [])
    for item in confirmed:
        provenance.setdefault(address(item['target']), []).append({
            'type': 'ghidra-confirmed-anchored-jsr',
            'call_site': item['call_site'], 'anchor_call_site': item['anchor_call_site'],
            'target_resolution': item['target_resolution'],
            'return_semantics_verified': False})
    for probe in probes:
        provenance.setdefault(address(probe['target']), []).append(
            {'type': 'anchored-jsr-byte-probe', 'anchor_call_site': probe['anchor_call_site'],
             'call_site': probe['call_site'], 'execution_proven': False})
    for call in callsites:
        provenance.setdefault(address(call['target']), []).append(
            {'type': 'ghidra-direct-call', 'caller_entry': call['caller_entry'],
             'call_site': call['call_site']})
    # Explicit exports without a vector or incoming Ghidra call are retained
    # but never labeled automatically proven function entries.
    for entry in functions:
        provenance.setdefault(entry, []).append({'type': 'exported-seed-not-proven-independent'})
    owners: dict[int, set[int]] = {}
    for entry, fun in functions.items():
        for ins in fun['instructions']:
            owners.setdefault(address(ins['address']), set()).add(entry)
    overlapping_entries = set()
    for occurrences in owners.values():
        if len(occurrences) > 1:
            overlapping_entries.update(occurrences)
    candidates = []
    for entry in sorted(provenance):
        fun = functions.get(entry)
        source = provenance[entry]
        interrupt = any(p['type'] == 'cpu-vector' and p['name'] != 'RESET' for p in source)
        grounded = any(p['type'] in ('cpu-vector', 'ghidra-direct-call',
                                     'ghidra-confirmed-anchored-jsr') for p in source)
        reasons, metrics = classify(fun, interrupt) if fun else (['awaiting-Ghidra-disassembly'], {})
        # Proof of an instruction's encoded target is not proof that the
        # caller reaches it, but caller reachability is NOT a callee defect.
        # Keep uncertainty separate without loosening any callee safety gate.
        evidence_caveats = []
        if any(p['type'] == 'ghidra-confirmed-anchored-jsr' for p in source):
            evidence_caveats.append('anchored-call-reachability-unverified')
        if entry in overlapping_entries:
            reasons.append('overlapping-exported-CFGs: independent-boundaries-unproven')
        if not grounded:
            reasons.insert(0, 'seed-has-no-vector-or-decoded-call-provenance')
        if any(p.get('name') == 'RESET' for p in source):
            reasons.append('reset-entry: not-an-independent-leaf-candidate')
        reasons = list(dict.fromkeys(reasons))
        # Candidate priority is for where to direct T2.B.8 engineering, NOT
        # a behavioral equivalence score or a claim that the routine is leaf.
        scores = (90 if fun and not reasons else 45 if fun else 20)
        if any(p['type'] == 'ghidra-direct-call' for p in source):
            scores += 15
        if fun:
            scores += max(0, 12 - len(fun['instructions']) // 25)
        scores -= 10 * len(reasons)
        candidates.append({
            'entry': hx(entry), 'bank_context': 'bank4' if entry < 0x6000 else 'fixed',
            'provenance': source, 'discovery': 'exported' if fun else 'not-yet-exported',
            'independent_entry_evidence': grounded,
            'classification': 'eligible-for-codegen-review' if not reasons else 'requires-review',
            'review_blockers': reasons, 'evidence_caveats': evidence_caveats,
            'metrics': metrics, 'triage_score': scores,
        })
    candidates.sort(key=lambda c: (-c['triage_score'], address(c['entry'])))
    ready = [c for c in candidates if c['classification'] == 'eligible-for-codegen-review']
    review = [c for c in candidates if c['classification'] != 'eligible-for-codegen-review'
              and not any(s['type'] == 'cpu-vector' and s['name'] == 'RESET'
                          for s in c['provenance'])]
    selected = (ready + review)[:max_shortlist]
    selection = {
        'schema': 'gng.function-shortlist.v1', 'source_inventory': 'functions-inventory.json',
        'requested': max_shortlist, 'chosen': len(selected),
        'eligible_for_codegen_review': sum(c['classification'] == 'eligible-for-codegen-review'
                                           for c in selected),
        'items': [{'entry': c['entry'], 'classification': c['classification'],
                   'provenance': c['provenance'], 'review_blockers': c['review_blockers'],
                   'evidence_caveats': c['evidence_caveats'],
                   'next_action': ('T2.B.8: manually verify generated operations and independent vectors'
                                   if c['classification'] == 'eligible-for-codegen-review'
                                   else 'T2.B.7: disassemble or resolve all review blockers')}
                  for c in selected],
        'acceptance_met': sum(c['classification'] == 'eligible-for-codegen-review'
                              for c in selected) >= max_shortlist,
    }
    result = {'schema': SCHEMA, 'rom_set': 'gngb', 'processor': CPU,
              'flat_sha256': hashlib.sha256(image).hexdigest(),
              'vector_table': vectors, 'exported_function_count': len(functions),
              'decoded_direct_calls': callsites,
              'ghidra_confirmed_anchored_calls': confirmed,
              'ghidra_rejected_anchored_probes': raw.get('anchored_rejected_probes', []),
              'anchored_jsr_probes': probes,
              'call_continuation_gaps': [
                  {'entry': f['entry'], 'gaps': f.get('unrecovered_call_continuations', 0)}
                  for f in raw['functions'] if f.get('unrecovered_call_continuations', 0)],
              'partial_discovery': bool(raw.get('partial_discovery')),
              'skipped': raw.get('skipped', []), 'candidates': candidates}
    return result, selection


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('out/functions.raw.json'))
    parser.add_argument('--rom-image', type=Path, default=Path('out/gngb-flat.bin'))
    parser.add_argument('--out', type=Path, default=Path('out/functions-inventory.json'))
    parser.add_argument('--shortlist', type=Path, default=Path('out/functions-shortlist.json'))
    parser.add_argument('--max-shortlist', type=int, default=3)
    args = parser.parse_args()
    result, shortlist = inventory(json.loads(args.input.read_text()), args.rom_image.read_bytes(),
                                  args.max_shortlist)
    for path, data in ((args.out, result), (args.shortlist, shortlist)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')
    print(f'GNG_FUNCTION_INVENTORY=PASS exported={result["exported_function_count"]} '
          f'calls={len(result["decoded_direct_calls"])} candidates={len(result["candidates"])}')
    if 'ghidra_confirmed_anchored_calls' in result:
        confirmed = result['ghidra_confirmed_anchored_calls']
        rejected = result['ghidra_rejected_anchored_probes']
        print(f'GNG_GHIDRA_ANCHORED_JSR=REVIEW verified={len(confirmed)} '
              f'rejected={len(rejected)}')
        for rejection in rejected[:6]:
            print('GHIDRA_ANCHOR_REJECTED', rejection)
    if result['anchored_jsr_probes']:
        seed_list = ' '.join(sorted({x['target'] for x in result['anchored_jsr_probes']}))
        print(f'GNG_ANCHORED_JSR_PROBES=UNVERIFIED count={len(result["anchored_jsr_probes"])} '
              f'candidate_seeds={seed_list}')
    if result['call_continuation_gaps']:
        print(f'GNG_CALL_CONTINUATION_GAPS={len(result["call_continuation_gaps"])} '
              f'details={result["call_continuation_gaps"]}')
    print(f'GNG_FUNCTION_SHORTLIST={"READY" if shortlist["acceptance_met"] else "PARTIAL"} '
          f'candidates={shortlist["chosen"]} '
          f'eligible={shortlist["eligible_for_codegen_review"]}')
    for c in shortlist['items']:
        print(f'  {c["entry"]}: {c["classification"]}: {", ".join(c["review_blockers"]) or "pending behavioral test"}')


if __name__ == '__main__':
    main()
