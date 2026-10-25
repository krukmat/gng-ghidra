#!/usr/bin/env python3
"""Offline T5 preflight. Checks the checkout, never runs MAME or GitHub Actions."""
from __future__ import annotations
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SCHEMA='gng.r42.t5-preflight.v1'
REQUIRED=('scripts/r3-local-regression.sh','scripts/r42_validation_closure.py',
          'scripts/r42h_romfree_gate.mjs','src/r42h_romfree_gate.mjs',
          'src/r42g_incremental_timeline.mjs',
          'tests/test_r42h_romfree_gate.mjs',
          'tests/test_r42_validation_closure.py')
PATTERN=re.compile(r'\b(?:src|scripts|tests)/[\w./-]+\.(?:mjs|py)\b')

def command(argv, cwd):
    try:
        r=subprocess.run(argv,cwd=cwd,stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL,text=True,timeout=10,check=False)
        return r.stdout.strip() if r.returncode==0 else None
    except (OSError,subprocess.TimeoutExpired):
        return None

def preflight(root:Path,expected_head:str|None=None,probe=command)->dict:
    root=root.resolve()
    version_python=f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}'
    version_node=probe(['node','--version'],root)
    head=probe(['git','rev-parse','HEAD'],root) if (root/'.git').exists() else None
    runner=root/'scripts/r3-local-regression.sh'
    referenced=set(REQUIRED)
    if runner.is_file():
        referenced.update(PATTERN.findall(runner.read_text(encoding='utf-8')))
    missing=sorted(path for path in referenced if not (root/path).is_file())
    node_ok=bool(version_node and re.fullmatch(r'v\d+\.\d+\.\d+',version_node)
                 and int(version_node[1:].split('.')[0])>=18)
    python_ok=sys.version_info>=(3,10)
    head_ok=bool(head and re.fullmatch('[0-9a-f]{40}',head))
    status=('BLOCKED_MISSING_CHECKOUT' if missing or not head_ok else
            'BLOCKED_RUNTIME' if not node_ok or not python_ok else
            'BLOCKED_HEAD_MISMATCH' if expected_head and head!=expected_head else
            'READY_TO_ATTEMPT_REGRESSION')
    return {'schema':SCHEMA,'status':status,'root_has_git':(root/'.git').exists(),
            'head':head,'expected_head':expected_head,'head_matches':
            bool(head and (expected_head is None or head==expected_head)),
            'python_version':version_python,'node_version':version_node,
            'required_files':len(referenced),'missing_paths':missing,
            'mame_required':False,'rom_required':False,'github_actions_used':False,
            'full_suite_executed':False,'native_equivalence_verified':False}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--expected-head')
    parser.add_argument('--out',type=Path)
    args=parser.parse_args(argv)
    report=preflight(args.root,args.expected_head)
    if args.out:
        dest=args.out.resolve();private=(args.root.resolve()/'out').resolve()
        if dest==private or private not in dest.parents:
            raise SystemExit('R42_T5_PRIVATE_OUT_REQUIRED')
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(json.dumps(report,sort_keys=True,indent=2)+'\n')
    print(json.dumps(report,sort_keys=True,indent=2))
    return 0 if report['status']=='READY_TO_ATTEMPT_REGRESSION' else 2
if __name__=='__main__':raise SystemExit(main())
