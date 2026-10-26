/** V3.B3 OFFLINE discovery only: a block map that, on a miss, compiles
 * the missing (bank, pc, overlay) target with the SAME AOT compiler and
 * records it as a seed, so one replay discovers every reached target
 * instead of halting once per target.
 *
 * Never shipped: frozen bundles are rebuilt from the recorded seeds by
 * compileProgram() as static ESM (rewriteProgram rejects Function/eval),
 * then re-certified on a plain Map with no fallback.
 */
import {compileProgram,RAM_KEY} from './mc6809_aot.mjs';

export function seedFromKey(key){
  if(!Number.isSafeInteger(key)||key<0)throw Error('V3_B3_KEY_INVALID');
  if(key>=RAM_KEY){
    const rel=key-RAM_KEY;
    return {bank:null,pc:rel&0xffff,overlay:Math.floor(rel/0x10000)};
  }
  if(key<0x10000)return {bank:null,pc:key,overlay:null};
  return {bank:(key>>16)-1,pc:key&0xffff,overlay:null};
}

/** Evaluates generated program source in-process (build tool only). */
function evaluate(source,lib){
  const body=source.replace(/^import \* as L from "[^"]+";$/m,'')
    .replace('export const blocks=new Map();','const blocks=new Map();');
  return new Function('L',body+'\nreturn blocks;')(lib);
}

export function createOnDemandBlocks(base,code,{libUrl,lib}){
  const found=[];
  class OnDemandBlocks extends Map{
    get(key){
      const fn=super.get(key);
      if(fn)return fn;
      const seed=seedFromKey(key);
      found.push(seed);
      const generated=compileProgram(code,[seed],{libUrl});
      for(const [k,f] of evaluate(generated.source,lib))
        if(!super.has(k))super.set(k,f);
      return super.get(key);
    }
  }
  return {blocks:new OnDemandBlocks(base),found};
}
