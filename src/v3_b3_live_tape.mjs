/** V3.B3 G1.4 live port recorder: what the CPU actually read from the
 * input/DIP ports (0x3000-0x3004) during a live session, as value changes
 * at exact CPU cycles. Replaying those values at the same cycles reproduces
 * the session bit for bit, including any halt. Inputs only: no ROM, RAM or
 * video bytes are recorded.
 */
export const LIVE_TAPE_SCHEMA='gng.v3.b3-live-tape.v1';
const PORTS=5;

/** Records [port, cycle, value] whenever a port's value differs from the
 * last value the CPU read there (first read of each port always). */
export function createPortRecorder(){
  const last=new Array(PORTS).fill(null);
  let pending=[];
  return {
    observe(addr,cycle,value){
      const port=addr-0x3000;
      if(port<0||port>=PORTS)throw Error('V3_B3_LIVE_TAPE_PORT');
      if(last[port]===value)return;
      last[port]=value;
      pending.push([port,cycle,value]);
    },
    drain(){const out=pending;pending=[];return out;}
  };
}

/** portRead for createBoard from recorded changes; reads must not go back
 * in time, which holds for one deterministic run. */
export function liveTapeReader(changes){
  const per=Array.from({length:PORTS},()=>[]);
  let prevCycle=-1;
  for(const [port,cycle,value] of changes){
    if(!Number.isInteger(port)||port<0||port>=PORTS||!Number.isInteger(cycle)||
       cycle<prevCycle||!Number.isInteger(value)||value<0||value>255)
      throw Error('V3_B3_LIVE_TAPE_INVALID');
    prevCycle=cycle;
    per[port].push([cycle,value]);
  }
  const at=new Array(PORTS).fill(-1);
  let lastCycle=-1;
  return (addr,cycle)=>{
    const port=addr-0x3000,list=per[port];
    if(!list||cycle<lastCycle)throw Error('V3_B3_LIVE_TAPE_READ_ORDER');
    lastCycle=cycle;
    while(at[port]+1<list.length&&list[at[port]+1][0]<=cycle)at[port]++;
    if(at[port]<0)throw Error('V3_B3_LIVE_TAPE_UNRECORDED_READ');
    return list[at[port]][1];
  };
}
