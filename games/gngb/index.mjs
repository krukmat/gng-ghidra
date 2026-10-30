/** gngb game input: binary revision, region roles and exact region checks.
 * Sizes and SHA-256 come from the recipe; this module only names the roles.
 */
import {gngbCodeImage} from './code-image.mjs';

export const GAME_ID='gngb';
export const REVISION='gngb';
export const PROGRAM_REGIONS=Object.freeze(['gg4','gg3','gg5']);
export const SOUND_REGION='gg2';

const fail=code=>{const e=Error(code);e.code=code;throw e;};
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');

/** Accept exactly the recipe's regions, by ID, size and SHA-256. */
export async function verifyInput(recipe,regions){
  if(recipe?.game?.id!==GAME_ID||recipe.binary?.revision!==REVISION||
     regions===null||typeof regions!=='object')fail('GNGB_INPUT_RECIPE_MISMATCH');
  const declared=new Map(recipe.binary.regions.map(r=>[r.id,r]));
  for(const id of [...PROGRAM_REGIONS,SOUND_REGION])
    if(!declared.has(id))fail('GNGB_INPUT_REGION_UNDECLARED '+id);
  const given=Object.keys(regions);
  if(given.length!==declared.size||given.some(id=>!declared.has(id)))
    fail('GNGB_INPUT_REGION_SET');
  const verified={};
  for(const [id,region] of declared){
    const bytes=regions[id];
    if(!(bytes instanceof Uint8Array)||bytes.length!==region.bytes||
       hex(await crypto.subtle.digest('SHA-256',bytes))!==region.sha256)
      fail('GNGB_INPUT_REGION_MISMATCH '+id);
    verified[id]=bytes;
  }
  return {revision:REVISION,regions:Object.freeze(verified)};
}

/** The AOT program must have been built from these program regions. */
export function assertProgramMatches(code,regions){
  const image=gngbCodeImage(name=>regions[name.replace('.bin','')]);
  const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
  if(!same(code.fixed.subarray(0x6000),image.fixed.subarray(0x6000))||
     !same(code.banks,image.banks))fail('GNGB_PROGRAM_REGION_MISMATCH');
}
