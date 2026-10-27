/** V3.B3 g5+: static closure of the ROM code (H3 paso 5). Direct control
 * flow from the CPU vectors and the recovered jump tables, plus two
 * patterns direct flow misses:
 *  - load-immediate continuations (LDX/LDY/LDU/LDD #addr), e.g.
 *    `LDY #$607D; JMP $54FF` returning through `JMP ,Y`;
 *  - pointer tables at such an immediate (`LDU #table; JMP [B,U]`), up to
 *    `table` consecutive words (null words skipped); a window table read
 *    from fixed code is tried in every bank.
 * Fixed code jumping into the bank window is followed in every bank.
 * Over-approximates on purpose: data decoded as code is compiled but never
 * reached at run time.
 */
import {compileBlock,blockKey,FIXED_START,BANK_START} from './mc6809_aot.mjs';
import {jumpTableSeeds} from './v3_b3_jump_tables.mjs';

const LOAD_IMM=[0x8e,0xce,0xcc,0x108e,0x10ce];
const INDIRECT=[0x6e,0xad];

export function staticClosure(code,{table=64}={}){
  const BANKS=code.banks.length/0x2000;
  const byteAt=(b,a)=>a>=FIXED_START?code.fixed[a]:code.banks[b*0x2000+a-BANK_START];
  const vec=a=>code.fixed[a]<<8|code.fixed[a+1];
  const roots=[0xfff2,0xfff4,0xfff6,0xfff8,0xfffa,0xfffc,0xfffe]
    .map(a=>({bank:null,pc:vec(a)})).filter(s=>s.pc>=FIXED_START);
  const queue=[...roots,...jumpTableSeeds(code)];
  const push=(b,a)=>{
    if(a>=FIXED_START)queue.push({bank:null,pc:a});
    else if(a>=BANK_START){
      if(b!==null)queue.push({bank:b,pc:a});
      else for(let k=0;k<BANKS;k++)queue.push({bank:k,pc:a});
    }
  };
  const seeds=[],reached=new Set(),covered=new Set(),stops=new Map();
  let immediates=0,indirect=0;
  while(queue.length){
    const {bank,pc}=queue.shift();
    const b=pc>=FIXED_START?null:bank,key=blockKey(b,pc);
    if(reached.has(key))continue;
    reached.add(key);
    seeds.push({bank:b,pc});
    const blk=compileBlock(code,b,pc,stops,null,true);
    for(const a of blk.pcs){
      covered.add(blockKey(b,a));
      let o=byteAt(b,a),q=a+1;
      if(o===0x10){o=0x1000|byteAt(b,q);q++;}
      if(INDIRECT.includes(o)&&a===blk.pcs.at(-1))indirect++;
      if(!LOAD_IMM.includes(o)||q+1>0xffff)continue;
      const imm=byteAt(b,q)<<8|byteAt(b,q+1);
      if(imm<BANK_START)continue;
      immediates++;
      push(b,imm);
      const banks=imm>=FIXED_START?[null]:b!==null?[b]:[...Array(BANKS).keys()];
      for(const tb of banks)for(let i=0;i<table;i++){
        const x=imm+2*i;
        if(x+1>0xffff||(imm<FIXED_START&&x+1>=FIXED_START))break;
        const w=byteAt(tb,x)<<8|byteAt(tb,x+1);
        if(w===0)continue;
        if(w<BANK_START)break;
        push(w>=FIXED_START?null:tb,w);
      }
    }
    for(const t of blk.succ)push(b,t);
  }
  return {seeds,reached,covered,roots:roots.length,immediates,indirect,banks:BANKS};
}
