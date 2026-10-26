/** V3.B2B: prove that historical seed inputs reproduce the exact B2A
 * frozen AOT program. Older builders permitted harmless/inert seed tuples
 * that are not legal *new execution targets*. Do not rewrite or drop them.
 */
import {sha256,rewriteProgram} from './v2_b1_frozen.mjs';

const deny=reason=>{throw Error('V3_B2B_'+reason);};
export function foundationSeedShape(x,code){
  // Exactly the historical B2A builder acceptance contract. Semantic
  // execution targets are separately checked when discovering new blocks.
  return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
    Number.isInteger(x.pc)&&x.pc>=0&&x.pc<=0xffff&&
    (x.bank===null||Number.isInteger(x.bank)&&x.bank>=0&&x.bank<=4)&&
    (x.overlay===undefined||x.overlay===null||
      Number.isInteger(x.overlay)&&x.overlay>=0&&
      x.overlay<code.ramOverlays.length);
}
/** AOT source must match all immutable bytes of B2A's program.mjs.
 * Program equivalence, not a loose count check, attests historical seeds.
 */
export function attestFoundationSeeds({
  raw,code,manifest,compileProgram,libUrl
}){
  if(!Array.isArray(raw)||raw.length<1||raw.length>3000||
     raw.some(x=>!foundationSeedShape(x,code)))
    deny('FOUNDATION_SEEDS_SHAPE_INVALID');
  if(typeof compileProgram!=='function'||!code?.fixed||
     code.fixed.length!==0x10000||!Array.isArray(code.ramOverlays)||
     typeof libUrl!=='string'||!libUrl.startsWith('file:'))
    deny('FOUNDATION_INPUT_INVALID');
  if(!Number.isInteger(manifest?.blocks)||manifest.blocks<1||
     typeof manifest.files?.['program.mjs']!=='string'||
     !/^[a-f0-9]{64}$/.test(manifest.files['program.mjs']))
    deny('FOUNDATION_PROOF_INVALID');
  const vec=addr=>code.fixed[addr]<<8|code.fixed[addr+1];
  const base=[{bank:null,pc:vec(0xfffe)},
    {bank:null,pc:vec(0xfff8)}];
  const built=compileProgram(code,[...base,...raw],{libUrl});
  const digest=sha256(rewriteProgram(built.source));
  if(built.blockCount!==manifest.blocks||
     digest!==manifest.files['program.mjs'])
    deny('FOUNDATION_AOT_MISMATCH');
  return {seeds:[...base,...raw],count:built.blockCount,
    seedCount:raw.length,sha256:digest};
}
