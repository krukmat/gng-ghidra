/** Live CPU I/O witness: records only actual MC6809 AOT bus reads.
 * No input is manufactured, no RAM/CPU/video state is modified.
 * A low bit means active sample; repeated reads count separately.
 */
import {INPUT_CONTROLS} from './gngb_input_contract.mjs';
export const WITNESS_NAMES=Object.freeze([
  'coin1','start1','p1.right','p1.left','p1.up','p1.down',
  'p1.button1','p1.button2'
]);
const PORTS=Object.freeze({SYSTEM:0x3000,P1:0x3001});
export function createPortReadWitness(){
  const counts=Object.fromEntries(WITNESS_NAMES.map(k=>[k,0]));
  const first=Object.fromEntries(WITNESS_NAMES.map(k=>[k,null]));
  let total=0,system=0,p1=0,last=null;
  const observe=read=>{
    if(!read||!Number.isSafeInteger(read.addr)||
       !Number.isSafeInteger(read.cycle)||read.cycle<0||
       !Number.isInteger(read.value)||read.value<0||read.value>255)
      throw Error('V3_B2C_WITNESS_INVALID_READ');
    total++;
    if(read.addr===PORTS.SYSTEM)system++;
    if(read.addr===PORTS.P1)p1++;
    for(const name of WITNESS_NAMES){
      const {port,bit}=INPUT_CONTROLS[name];
      if(read.addr===PORTS[port]&&(read.value&bit)===0){
        counts[name]++;
        const at={control:name,cycle:read.cycle,
          pc:Number.isInteger(read.pc)?read.pc:null};
        if(first[name]===null)first[name]=at;
        last=at;
      }
    }
  };
  const snapshot=()=>({
    busReads:total,systemReads:system,p1Reads:p1,
    activeSamples:{...counts},
    firstActive:Object.fromEntries(WITNESS_NAMES.map(k=>[k,first[k]])),
    lastActive:last
  });
  return {observe,snapshot};
}
