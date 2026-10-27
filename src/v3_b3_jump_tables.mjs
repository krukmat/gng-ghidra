/** V3.B3 G1.4 static jump-table recovery (build time only).
 *
 * GnG dispatches object/state handlers through tables of code addresses:
 *   LD{X,Y,U} #table ... JMP/JSR [{A,B,D},reg]
 * Tapes only reach the handlers they happen to trigger, so a live game
 * halts on the first unvisited one (e.g. 0xEAC0 -> table 0xEAC8 -> 0xEC83).
 * Every entry becomes a compile seed. A table is read word by word while
 * the word is a code address valid for the site's region, and stops where
 * its lowest forward target starts (tables precede the code they index).
 * A false positive only compiles data as code that never runs; invalid
 * opcodes compile to $.bad(), so extra seeds cannot change execution.
 */
import {FIXED_START,BANK_START} from './gngb_block_key.mjs';

const MAX_ENTRIES=128,MAX_LOOKBACK=12;
const INDIRECT_ACC=new Set([0x95,0x96,0x9b]); // [B,r] [A,r] [D,r]

function views(code){
  const out=[{bank:null,lo:FIXED_START,hi:0x10000,
    rd:a=>a>=FIXED_START&&a<=0xffff?code.fixed[a]:undefined}];
  const banks=code.banks.length/0x2000;
  for(let b=0;b<banks;b++)out.push({bank:b,lo:BANK_START,hi:FIXED_START,
    rd:a=>a>=FIXED_START&&a<=0xffff?code.fixed[a]:
      a>=BANK_START&&a<FIXED_START?code.banks[b*0x2000+a-BANK_START]:undefined});
  return out;
}

/** Table base loaded into register r (0=X,1=Y,2=U) shortly before `site`. */
function tableBase(rd,site,r){
  for(let back=3;back<=MAX_LOOKBACK;back++){
    const p=site-back;
    if(r===0&&rd(p)===0x8e)return rd(p+1)<<8|rd(p+2);
    if(r===2&&rd(p)===0xce)return rd(p+1)<<8|rd(p+2);
    if(r===1&&rd(p)===0x10&&rd(p+1)===0x8e)return rd(p+2)<<8|rd(p+3);
  }
  return null;
}

/** [{site,bank,base,targets:[pc]}] for every indexed indirect jump table. */
export function findJumpTables(code){
  const tables=[];
  for(const {bank,lo,hi,rd} of views(code)){
    const seen=new Set();
    const valid=x=>x>=FIXED_START||(bank!==null&&x>=BANK_START);
    for(let site=lo;site<hi-1;site++){
      const op=rd(site),pb=rd(site+1);
      if((op!==0x6e&&op!==0xad)||pb===undefined||!INDIRECT_ACC.has(pb&0x9f))continue;
      const r=(pb>>5)&3;
      if(r===3)continue;
      const base=tableBase(rd,site,r);
      if(base===null||seen.has(base))continue;
      seen.add(base);
      const targets=[];
      let limit=0x10000;
      for(let i=0;i<MAX_ENTRIES;i++){
        const p=base+2*i;
        if(p+1>=limit)break;
        const hiB=rd(p),loB=rd(p+1);
        if(hiB===undefined||loB===undefined)break;
        const x=hiB<<8|loB;
        if(!valid(x))break;
        targets.push(x);
        if(x>base)limit=Math.min(limit,x);
      }
      if(targets.length)tables.push({site,bank,base,targets});
    }
  }
  return tables;
}

/** Compile seeds ({bank,pc}) for every recovered table target. */
export function jumpTableSeeds(code){
  const seeds=[],keys=new Set();
  for(const t of findJumpTables(code))for(const pc of t.targets){
    const bank=pc>=FIXED_START?null:t.bank;
    const k=(bank??-1)+':'+pc;
    if(!keys.has(k)){keys.add(k);seeds.push({bank,pc});}
  }
  return seeds;
}
