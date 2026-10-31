/** GnG code run from main RAM: the copy is located in ROM so the build can
 * compile it as an overlay. A RAM run of at least 16 known bytes from `pc`
 * must occur exactly once (longest match) in the fixed region or one bank.
 */
const romByte=(code,bank,a)=>a>=0x6000||bank===null?code.fixed[a]:
  code.banks[bank*0x2000+a-0x4000];

/** {start, bytes} overlay for the RAM code at `pc`, or null if ambiguous. */
export function locateRamCode(code,state,pc){
  const {bytes,known}=state.ramBytes(pc,0x3000-pc);
  let n=0;while(n<bytes.length&&known[n]===255)n++;
  const spaces=[{bank:null,base:0x6000,data:code.fixed.subarray(0x6000)}];
  for(let b=0;b<code.banks.length/0x2000;b++)
    spaces.push({bank:b,base:0x4000,data:code.banks.subarray(b*0x2000,(b+1)*0x2000)});
  let best=null,ties=0;
  for(const sp of spaces){
    for(let o=0;o<sp.data.length;o++){
      let m=0;while(m<n&&o+m<sp.data.length&&sp.data[o+m]===bytes[m])m++;
      if(m<16)continue;
      if(!best||m>best.length){best={bank:sp.bank,addr:sp.base+o,length:m};ties=0;}
      else if(m===best.length)ties++;
    }
  }
  if(!best||ties)return null;
  return {start:pc,bytes:Uint8Array.from({length:best.length},(_,i)=>
    romByte(code,best.bank,best.addr+i))};
}

/** Index of the overlay whose bytes are all known and current at `pc`. */
export function currentOverlay(code,state,pc){
  const {bytes,known}=state.ramBytes(0,0x3000);
  return code.ramOverlays.findIndex(ov=>pc>=ov.start&&
    pc<ov.start+ov.bytes.length&&ov.bytes.every((v,i)=>
      known[ov.start+i]===255&&bytes[ov.start+i]===v));
}
