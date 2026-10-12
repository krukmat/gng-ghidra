#!/usr/bin/env python3
"""Summarize every discovered 6809 entry and its real codegen blockers.

Consumes only local ROM-authenticated output artifacts. It never performs
disassembly, interprets P-code, or infers dynamic reachability.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def render(inventory: dict, report: dict | None = None, limit: int = 24) -> list[str]:
    if inventory.get('schema') != 'gng.function-inventory.v1':
        raise ValueError('Expected ROM-authenticated function-inventory.v1')
    if not isinstance(inventory.get('candidates'), list):
        raise ValueError('Missing inventory candidates')
    candidates = inventory['candidates']
    verified = inventory.get('ghidra_confirmed_anchored_calls', [])
    eligible = sum(c['classification'] == 'eligible-for-codegen-review' for c in candidates)
    lines = [f'GNG_T2B_TRIAGE=PASS exported={inventory["exported_function_count"]} '
             f'candidates={len(candidates)} verified_jsr_sites={len(verified)} '
             f'eligible_for_codegen_review={eligible}']
    compiler_blocks = {}
    if report is not None:
        if not isinstance(report.get('blocked'), list):
            raise ValueError('Malformed function codegen report')
        compiler_blocks = {x['entry']: x['reason'] for x in report['blocked']}
    for c in candidates[:limit]:
        metrics = c.get('metrics', {})
        source = sorted(set(p['type'] for p in c.get('provenance', [])))
        reasons = c.get('review_blockers', [])
        warnings = c.get('evidence_caveats', [])
        line = (
            f'  {c["entry"]} {c["classification"]} '
            f'export={c["discovery"]} '
            f'origin={",".join(source)} '
            f'ins={metrics.get("instruction_count", "-")} '
            f'returns={metrics.get("return_count", "-")} '
            f'memory={metrics.get("memory_proof", {}).get("safe", 0)}/'
            f'{metrics.get("memory_proof", {}).get("total", 0)} '
            f'blockers={";".join(reasons) if reasons else "none"}'
        )
        if warnings:
            line += f' caveats={";".join(warnings)}'
        if c['entry'] in compiler_blocks:
            line += ' compiler=' + compiler_blocks[c['entry']].replace('\n', ' ')[:140]
        lines.append(line)
    lines.append(
        'GNG_T2B_ACCEPTANCE=NOT_ESTABLISHED '
        'codegen-review eligibility is not behavioral equivalence'
    )
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, default=Path('out/functions-inventory.json'))
    parser.add_argument('--report', type=Path, default=Path('out/functions.report.json'))
    parser.add_argument('--limit', type=int, default=24)
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error('--limit must be 1..100')
    inventory = json.loads(args.inventory.read_text())
    report = json.loads(args.report.read_text()) if args.report.exists() else None
    print('\n'.join(render(inventory, report, args.limit)))


if __name__ == '__main__':
    main()
