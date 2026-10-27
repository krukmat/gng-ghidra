#!/usr/bin/env node
/** H3 paso 5.0: cierre estático de control directo desde los vectores y las
 * tablas de salto, siguiendo además fijo -> ventana de banco en los 5 bancos.
 * Solo mide; no genera bundles. Uso: node scripts/h3_static_cover.mjs
 */
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {compileBlock,blockKey,FIXED_START,BANK_START} from '../src/mc6809_aot.mjs';
import {jumpTableSeeds} from '../src/v3_b3_jump_tables.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const DIR=selectB3Bundle(ROOT).dir;
const {code}=loadFrozen(DIR);
const BANKS=code.banks.length/0x2000;
const vec=a=>code.fixed[a]<<8|code.fixed[a+1];
const roots=[0xfff2,0xfff4,0xfff6,0xfff8,0xfffa,0xfffc,0xfffe]
  .map(a=>({bank:null,pc:vec(a)})).filter(s=>s.pc>=FIXED_START);
const seeds=[...roots,...jumpTableSeeds(code)];
const reached=new Set(),covered=new Set(),stops=new Map(),queue=[...seeds];
let crossBank=0,immSeeds=0;
const IMM=process.env.H3_IMM!=='0',TAB=+(process.env.H3_TAB??64);
const byteAt=(b,a)=>a>=FIXED_START?code.fixed[a]:b===null?null:code.banks[b*0x2000+a-BANK_START];
const okPc=(b,a)=>a>=FIXED_START||(a>=BANK_START&&b!==null);
const push=(b,a)=>{if(a>=FIXED_START)queue.push({bank:null,pc:a});
  else if(a>=BANK_START){if(b!==null)queue.push({bank:b,pc:a});
    else for(let k=0;k<BANKS;k++)queue.push({bank:k,pc:a});}};
while(queue.length){
  const {bank,pc}=queue.shift();
  const b=pc>=FIXED_START?null:bank,key=blockKey(b,pc);
  if(reached.has(key))continue;
  reached.add(key);
  const blk=compileBlock(code,b,pc,stops,null,true);
  for(const a of blk.pcs){covered.add(blockKey(b,a));
    if(!IMM)continue;
    let o=byteAt(b,a),q=a+1;
    if(o===0x10){o=0x1000|byteAt(b,q);q++;}
    if(![0x8e,0xce,0xcc,0x108e,0x10ce].includes(o))continue;
    const imm=byteAt(b,q)<<8|byteAt(b,q+1);
    if(imm<BANK_START)continue;
    immSeeds++;push(b,imm);
    // Tabla de punteros en imm: palabras consecutivas que caen en código.
    // Desde código fijo, una tabla en la ventana puede estar en cualquier banco.
    const tbs=imm>=FIXED_START?[null]:b!==null?[b]:[...Array(BANKS).keys()];
    for(const tb of tbs)for(let i=0;i<TAB;i++){const x=imm+2*i;
      if(x+1>0xffff||(imm<FIXED_START&&x+1>=FIXED_START))break;
      const w=byteAt(tb,x)<<8|byteAt(tb,x+1);
      if(w<BANK_START)break;
      push(w>=FIXED_START?null:tb,w);}
  }
  for(const t of blk.succ){
    if(t>=FIXED_START)queue.push({bank:null,pc:t});
    else if(t>=BANK_START&&b!==null)queue.push({bank:b,pc:t});
    else if(t>=BANK_START){crossBank++;
      for(let k=0;k<BANKS;k++)queue.push({bank:k,pc:t});}
  }
}
const g4=new Set([...readFileSync(join(DIR,'program.mjs'),'utf8')
  .matchAll(/^blocks\.set\((0x[0-9a-f]+),function/gm)].map(m=>Number(m[1])));
const g4Fixed=[...g4].filter(k=>k<0x10000);
const known=k=>reached.has(k)||covered.has(k);
const targets={'bank3:519d':blockKey(3,0x519d),ec83:0xec83,affc:0xaffc,e79e:0xe79e,c3a3:0xc3a3};
for(const [n,k] of Object.entries(targets))
  console.log('H3_STATIC_TARGET_'+n+'='+(known(k)?'FOUND':'MISSING')+' g4='+(g4.has(k)?'yes':'no'));
const perBank=Array.from({length:BANKS},(_,k)=>[...reached].filter(x=>(x>>16)===k+1).length);
console.log('H3_STATIC_ROOTS='+roots.length+' table_seeds='+(seeds.length-roots.length)+
  ' blocks='+reached.size+' fixed='+[...reached].filter(k=>k<0x10000).length+
  ' per_bank='+perBank.join('/')+' cross_bank_targets='+crossBank+' imm_seeds='+immSeeds+' tab='+TAB);
if(process.env.H3_DUMP)console.log(JSON.stringify([...g4].filter(k=>k<0x100000&&!known(k)).concat(Object.values(targets).filter(k=>!known(k)))));
console.log('H3_STATIC_VS_G4 g4_functions='+g4.size+' g4_in_static='+
  [...g4].filter(known).length+' g4_fixed_missing='+g4Fixed.filter(k=>!known(k)).length+
  ' g4_bank_missing='+[...g4].filter(k=>k>=0x10000&&k<0x100000&&!known(k)).length);
