/** V3.B3 G1.4 live port recorder: what the CPU actually read from the
 * input/DIP ports (0x3000-0x3004) during a live session, as value changes
 * at exact CPU cycles. Replaying those values at the same cycles reproduces
 * the session bit for bit, including any halt. Inputs only: no ROM, RAM or
 * video bytes are recorded.
 */
import {decodeCheckpoint} from './checkpoint_format.mjs';
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

/** The frame record the runtime delivered at a checkpoint's frame, rebuilt
 * from its CPU state (gngb_runtime snapshot): RAM, sprite DMA and palette,
 * the bytes the renderer draws. */
export function checkpointRecord({mem,km,dma,dmaMask,pal,palExt}){
  const r=new Uint8Array(0x3800),k=new Uint8Array(0x3800);
  r.set(mem.subarray(0,0x2000));k.set(km.subarray(0,0x2000));
  if(dma){r.set(dma,0x2000);k.set(dmaMask,0x2000);}
  else k.fill(255,0x2000,0x2200); // no DMA yet: reference stores zeros
  r.set(mem.subarray(0x2000,0x3000),0x2200);k.set(km.subarray(0x2000,0x3000),0x2200);
  r.set(palExt,0x3200);r.set(pal,0x3300);k.fill(255,0x3200,0x3800);
  for(let i=0;i<256;i++){
    const o=0x3400+i*4;
    r[o]=(palExt[i]>>4)*17;r[o+1]=(palExt[i]&15)*17;r[o+2]=(pal[i]>>4)*17;r[o+3]=255;
  }
  return {record:r,known:k};
}

function decodeTape(text){
  let programSha256;
  try{programSha256=JSON.parse(text)?.programSha256;}catch{} // decode reports it
  const c=decodeCheckpoint(text,{programSha256});
  return {c,tape:{schema:LIVE_TAPE_SCHEMA,program_sha256:c.programSha256,frame:c.frame,
    changes:c.tape}};
}

/** A checkpoint's tape (port changes from reset) as a live tape file, the
 * input of rp3_compare's tape scenario. The checkpoint is fully checked. */
export function checkpointTape(text){return decodeTape(text).tape;}

/** checkpointTape plus the check lab tapes carry, {frame, record_sha256}
 * (sha256 of record then known), so a replay can prove the session reached
 * the same picture. Web Crypto: browser and Node. */
export async function checkedCheckpointTape(text){
  const {c,tape}=decodeTape(text),{record,known}=checkpointRecord(c.cpu);
  const bytes=new Uint8Array(record.length+known.length);
  bytes.set(record);bytes.set(known,record.length);
  const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  const record_sha256=[...digest].map(b=>b.toString(16).padStart(2,'0')).join('');
  return {...tape,check:{frame:c.frame,record_sha256}};
}
