/** H3 lab override (never shipped): H3_POKE="from:to:addr:value[,...]" writes
 * RAM right after frame record i for from<=i<=to, identically in the AOT
 * board (state.w) and in MAME (scripts/v3_b3_oracle.lua). Used only to start
 * laboratory comparisons at a later stage; records stay MAME-comparable.
 */
export function parseLabPokes(spec=process.env.H3_POKE??''){
  return spec.split(',').filter(Boolean).map(p=>{
    const [from,to,addr,value]=p.split(':').map(Number);
    if(![from,to,addr,value].every(Number.isInteger)||from<1||to<from||
       addr<0||addr>0x1dff||value<0||value>255)throw Error('H3_POKE_INVALID '+p);
    return {from,to,addr,value};
  });
}
export function applyLabPokes(pokes,state,index){
  for(const p of pokes)if(index>=p.from&&index<=p.to)state.w(p.addr,p.value,0);
}
