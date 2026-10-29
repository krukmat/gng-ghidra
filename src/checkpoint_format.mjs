/** gng.checkpoint.v1: one quick-save of a live session, shared by web and
 * Android (no Node imports). JSON where every Uint8Array is {"$u8":base64}.
 *   cpu   createBoard exportState() at a frame boundary (checkpoint_runtime)
 *   audio createAudioCommandSource exportState() after that frame's batch
 *   ym    dual-YM2203 bytes from src/ym2203_checkpoint.h (native or WASM)
 *   tape  port changes [port,cycle,value] from reset, so the session stays
 *         reproducible from reset even after a load.
 * RAM holds copies of ROM code: the file is private and never published.
 */
export const CHECKPOINT_SCHEMA='gng.checkpoint.v1';
export const CYCLES_PER_FRAME=25152;
export const SAMPLES_PER_FRAME=1048; // 25152 cycles x 8 ticks / 192 per sample

const fail=code=>{const e=Error(code);e.code=code;throw e;};
const toBase64=bytes=>{
  let s='';
  for(let i=0;i<bytes.length;i+=0x8000)
    s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(s);
};
const fromBase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const u64le=(bytes,at)=>{
  let x=0;
  for(let i=7;i>=0;i--)x=x*256+bytes[at+i];
  return x;
};
// First PCM sample the restored synthesizer renders ('first' in the header).
export const ymFirstSample=ym=>u64le(ym,4);

function check(c){
  if(c?.schema!==CHECKPOINT_SCHEMA||!/^[0-9a-f]{64}$/.test(c.programSha256??''))
    fail('CK_FORMAT_INVALID');
  if(!Number.isSafeInteger(c.frame)||c.frame<1||c.cpu?.frames!==c.frame||
     c.audio?.frontier!==c.frame*CYCLES_PER_FRAME||
     !(c.ym instanceof Uint8Array)||c.ym.length<36||
     String.fromCharCode(...c.ym.subarray(0,4))!=='GYM1'||
     ymFirstSample(c.ym)!==c.frame*SAMPLES_PER_FRAME||!Array.isArray(c.tape))
    fail('CK_STATE_INCONSISTENT');
  let prev=-1;
  for(const e of c.tape){
    if(!Array.isArray(e)||e.length!==3||!Number.isSafeInteger(e[1])||e[1]<prev)
      fail('CK_TAPE_INVALID');
    prev=e[1];
  }
  return c;
}

export function encodeCheckpoint({programSha256,frame,cpu,audio,ym,tape,
  savedAt=new Date().toISOString()}){
  const c=check({schema:CHECKPOINT_SCHEMA,programSha256,frame,savedAt,
    cpu,audio,ym,tape});
  return JSON.stringify(c,(k,v)=>v instanceof Uint8Array?{$u8:toBase64(v)}:v);
}

// Refuses a checkpoint made by another AOT program: its RAM, PC and block
// keys only mean something to the exact program that saved it.
export function decodeCheckpoint(text,{programSha256}){
  let c;
  try{
    c=JSON.parse(text,(k,v)=>v!==null&&typeof v==='object'&&
      typeof v.$u8==='string'&&Object.keys(v).length===1?fromBase64(v.$u8):v);
  }catch{fail('CK_FORMAT_INVALID');}
  check(c);
  if(c.programSha256!==programSha256)fail('CK_PROGRAM_MISMATCH');
  return c;
}
