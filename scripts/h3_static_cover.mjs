#!/usr/bin/env node
/** H3 paso 5: mide el cierre estático (src/v3_b3_static_closure.mjs) frente
 * al bundle B3 seleccionado. Solo mide. Uso: node scripts/h3_static_cover.mjs
 */
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {blockKey} from '../src/mc6809_aot.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {staticClosure} from '../src/v3_b3_static_closure.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const {generation,dir}=selectB3Bundle(ROOT);
const {code}=loadFrozen(dir);
const c=staticClosure(code,{table:+(process.env.H3_TAB??64)});
const known=k=>c.reached.has(k)||c.covered.has(k);
const have=new Set([...readFileSync(join(dir,'program.mjs'),'utf8')
  .matchAll(/^blocks\.set\((0x[0-9a-f]+),function/gm)].map(m=>Number(m[1])));
const targets={'bank3:519d':blockKey(3,0x519d),ec83:0xec83,affc:0xaffc,e79e:0xe79e,c3a3:0xc3a3};
for(const [n,k] of Object.entries(targets))
  console.log('H3_STATIC_TARGET_'+n+'='+(known(k)?'FOUND':'MISSING'));
const perBank=Array.from({length:c.banks},(_,k)=>[...c.reached].filter(x=>(x>>16)===k+1).length);
console.log('H3_STATIC_BLOCKS='+c.reached.size+' fixed='+[...c.reached].filter(k=>k<0x10000).length+
  ' per_bank='+perBank.join('/')+' roots='+c.roots+' immediates='+c.immediates+
  ' indirect_exits='+c.indirect);
const rom=[...have].filter(k=>k<0x100000);
console.log('H3_STATIC_VS_G'+generation+' functions='+have.size+' rom='+rom.length+
  ' rom_in_static='+rom.filter(known).length+
  ' rom_missing='+rom.filter(k=>!known(k)).slice(0,20).map(k=>k.toString(16)).join(','));
