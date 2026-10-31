/** Static MC6809 code discovery over a board code view (build time only).
 *
 * Strategies, each enabled explicitly by the project:
 *  - `vectors`: the seven 6809 vectors (0xfff2-0xfffe) read in the boot
 *    context;
 *  - `jumpTables`: indexed indirect jumps `JMP/JSR [{A,B,D},{X,Y,U}]` whose
 *    table base is loaded by `LDX/LDY/LDU #base` shortly before the site;
 *    entries are read while they resolve as code from the site's context and
 *    stop where the lowest forward target starts;
 *  - `flow`: direct control flow of every compiled block;
 *  - `immediates`: load-immediate continuations (`LDX/LDY/LDU/LDD #addr`)
 *    and up to `table` words of a pointer table at such an address.
 * All over-approximate on purpose: data decoded as code compiles but never
 * runs. Indirect exits are counted, not resolved: run-time discovery
 * (discover-run.mjs) records any target these strategies miss.
 *
 * Besides identity/resolve/read, the view supplies:
 *  - `targets({from, pc})`: every identity `pc` may be from `from` (a board
 *    window seen from fixed code may be any bank); defaults to `resolve`;
 *  - `scanRanges()`: `[{from, start, end}]` code ranges searched for tables.
 */
import {compileBlock} from './compiler.mjs';

const LOAD_IMM=[0x8e,0xce,0xcc,0x108e,0x10ce];
const INDIRECT=[0x6e,0xad];
const INDIRECT_ACC=new Set([0x95,0x96,0x9b]); // [B,r] [A,r] [D,r]
const VECTORS=[0xfff2,0xfff4,0xfff6,0xfff8,0xfffa,0xfffc,0xfffe];
const contextOf=x=>`${x.space}\u0000${x.context}\u0000${x.overlayVersion}`;

function access(view){
  const resolve=(from,pc)=>pc<0||pc>0xffff?null:view.resolve({from,pc});
  const byte=(from,pc)=>{
    const x=resolve(from,pc);
    return x?view.read(x,1)[0]:undefined;
  };
  const targets=(from,pc)=>{
    if(pc<0||pc>0xffff)return [];
    if(view.targets)return view.targets({from,pc});
    const x=resolve(from,pc);
    return x?[x]:[];
  };
  return {resolve,byte,targets};
}

/** [{from, site, base, targets: [identity]}] for every indexed indirect jump. */
export function findJumpTables(view,{maxEntries=128,lookback=12}={}){
  const {resolve,byte}=access(view),tables=[];
  for(const {from,start,end} of view.scanRanges()){
    const rd=a=>byte(from,a),seen=new Set();
    const tableBase=(site,r)=>{
      for(let back=3;back<=lookback;back++){
        const p=site-back;
        if(r===0&&rd(p)===0x8e)return rd(p+1)<<8|rd(p+2);
        if(r===2&&rd(p)===0xce)return rd(p+1)<<8|rd(p+2);
        if(r===1&&rd(p)===0x10&&rd(p+1)===0x8e)return rd(p+2)<<8|rd(p+3);
      }
      return null;
    };
    for(let site=start;site<end-1;site++){
      const op=rd(site),pb=rd(site+1);
      if((op!==0x6e&&op!==0xad)||pb===undefined||!INDIRECT_ACC.has(pb&0x9f))continue;
      const r=(pb>>5)&3;
      if(r===3)continue;
      const base=tableBase(site,r);
      if(base===null||seen.has(base))continue;
      seen.add(base);
      const found=[];
      let limit=0x10000;
      for(let i=0;i<maxEntries;i++){
        const p=base+2*i;
        if(p+1>=limit)break;
        const hi=rd(p),lo=rd(p+1);
        if(hi===undefined||lo===undefined)break;
        const x=hi<<8|lo,target=resolve(from,x);
        if(!target)break;
        found.push(target);
        if(x>base)limit=Math.min(limit,x);
      }
      if(found.length)tables.push({from,site,base,targets:found});
    }
  }
  return tables;
}

/** Static seeds and coverage counters for the enabled strategies. */
export function discoverStatic(view,{boot,vectors=true,flow=true,
  jumpTables=null,immediates=null}={}){
  const {resolve,byte,targets}=access(view);
  const key=x=>view.identity(x);
  const roots=[];
  if(vectors){
    if(!boot)throw Error('MIGRATION_DISCOVER_BOOT_CONTEXT');
    for(const a of VECTORS){
      const hi=byte(boot,a),lo=byte(boot,a+1);
      const x=hi===undefined||lo===undefined?null:resolve(boot,hi<<8|lo);
      if(x)roots.push(x);
    }
  }
  const tableSeeds=[],tableKeys=new Set();
  const tables=jumpTables?findJumpTables(view,jumpTables):[];
  for(const t of tables)for(const x of t.targets){
    const k=key(x);
    if(!tableKeys.has(k)){tableKeys.add(k);tableSeeds.push(x);}
  }
  const queue=[...roots,...tableSeeds],seeds=[],reached=new Set();
  const stops=new Map(),table=immediates?.table??0;
  let immediateCount=0,indirect=0;
  while(queue.length){
    const start=queue.shift(),k=key(start);
    if(reached.has(k))continue;
    reached.add(k);
    seeds.push(start);
    if(!flow&&!immediates)continue;
    const blk=compileBlock(view,start,stops,{entries:true});
    if(INDIRECT.includes(byte(start,blk.pcs.at(-1))))indirect++;
    if(immediates)for(const a of blk.pcs){
      const from=start;
      let o=byte(from,a),q=a+1;
      if(o===0x10){o=0x1000|byte(from,q);q++;}
      if(!LOAD_IMM.includes(o)||q+1>0xffff)continue;
      const imm=byte(from,q)<<8|byte(from,q+1),bases=targets(from,imm);
      if(!bases.length)continue;
      immediateCount++;
      queue.push(...bases);
      for(const tb of bases)for(let i=0;i<table;i++){
        const x=imm+2*i,end=resolve(tb,x+1);
        if(!end||contextOf(end)!==contextOf(tb))break;
        const w=byte(tb,x)<<8|byte(tb,x+1);
        if(w===0)continue;
        const next=targets(tb,w);
        if(!next.length)break;
        queue.push(...next);
      }
    }
    if(flow)for(const t of blk.succ)queue.push(...targets(start,t));
  }
  return {seeds,roots:roots.length,tables:tables.length,
    tableSeeds:tableSeeds.length,immediates:immediateCount,indirectExits:indirect};
}
