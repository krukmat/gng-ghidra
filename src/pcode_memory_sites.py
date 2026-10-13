"""Enumerate P-code data-memory accesses, including direct RAM varnodes.

Direct 'ram' operands represent concrete data-memory locations; the first
'ram' operand to BRANCH/CALL/RETURN is instead a control-flow target.
LOAD/STORE input[0] is an address-space identifier, not a data read.
"""
from __future__ import annotations

CODE_TARGET_OPS=frozenset({'BRANCH','CBRANCH','CALL','CALLIND','BRANCHIND','RETURN'})

def sites(p):
    """Yield (operation, pointer, size, form, role) for all data-memory sites."""
    op=p.get('op')
    inputs=p.get('inputs',[])
    output=p.get('output')
    if op in ('LOAD','STORE'):
        ptr=inputs[1] if len(inputs)>1 else None
        size=(output or {}).get('size') if op=='LOAD' else (
            inputs[2].get('size') if len(inputs)>2 and isinstance(inputs[2],dict)
            else None)
        yield op,ptr,size,'explicit','pointer'
    for i,node in enumerate(inputs):
        if not isinstance(node,dict) or str(node.get('space','')).casefold()!='ram':
            continue
        if i==0 and op in CODE_TARGET_OPS:
            continue
        if i==0 and op in ('LOAD','STORE'):
            continue
        yield 'LOAD',node,node.get('size'),'direct-varnode',f'input:{i}'
    if isinstance(output,dict) and str(output.get('space','')).casefold()=='ram':
        yield 'STORE',output,output.get('size'),'direct-varnode','output'
