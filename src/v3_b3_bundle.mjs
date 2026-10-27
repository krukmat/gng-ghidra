/** V3.B3 generations. Each generation is rebuilt from certified B2-D with
 * every tape in v3_b3_tapes.mjs into its own directory; earlier certified
 * generations are never modified and stay selectable while their tapes
 * still hash-match the current definitions.
 */
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadFrozen} from './v2_b1_frozen.mjs';
import {b3Certified} from './v3_b3_selection.mjs';
export const B3_GENERATION=3;
/** From g3 on, every instruction boundary is a block entry, so an IRQ
 * return into the middle of a block (live timing) always has code. */
export const B3_MULTI_ENTRY_FROM=3;
export function b3GenerationDir(root,generation=B3_GENERATION){
  if(!Number.isInteger(generation)||generation<1)
    throw Error('V3_B3_GENERATION_INVALID');
  return generation===1?join(root,'out/v3/b3'):join(root,'out/v3/b3','g'+generation);
}
/** Newest certified generation, or null. Validates every asset SHA-256. */
export function selectB3Bundle(root){
  for(let g=B3_GENERATION;g>=1;g--){
    const dir=b3GenerationDir(root,g);
    const frozen=join(dir,'frozen'),path=join(dir,'discovery-report.json');
    if(!existsSync(frozen)||!existsSync(path))continue;
    try{
      const report=JSON.parse(readFileSync(path,'utf8'));
      if((report.generation??1)!==g)continue;
      const {manifest}=loadFrozen(frozen);
      const {manifest:parent}=loadFrozen(join(root,'out/v3/b2d/frozen'));
      if(b3Certified(report,manifest,parent))return {generation:g,dir:frozen,report};
    }catch{}
  }
  return null;
}
