/** Checkpoint copy of the audio-capable runtime, shared by web and Android.
 * Three exact anchored patches add exportState()/importState() to
 * createBoard. exportState() is valid only between instructions (inside
 * onAudioComplete); importState() only before the first run(), which then
 * continues from the saved state instead of the reset vector.
 * The loop body and the frozen runtime file stay untouched.
 */
const STATE=`  let restored=false;
  const CK_SCALARS=['a','b','dp','x','y','u','s','cc','PC','ka','kb','kdp',
    'kx','ky','ku','ks','kcc','C','T','ipc','lk','irq','sync','bank',
    'soundlatch','snapped','frame'];
  const exportState=()=>({
    cpu:Object.fromEntries(CK_SCALARS.map(k=>[k,$[k]])),
    st:$.st&&[...$.st],scroll:[...$.scroll],latch:[...$.latch],
    writes:{...$.writes},frames:$.records.length,
    mem:mem.slice(),km:km.slice(),palExt:palExt.slice(),pal:pal.slice(),
    dma:$.dma&&$.dma.slice(),dmaMask:$.dmaMask&&$.dmaMask.slice()});
  const importState=s=>{
    if(restored||$.C!==0||$.events.length)throw Error('CK_IMPORT_AFTER_START');
    const bytes=(v,n)=>v instanceof Uint8Array&&v.length===n;
    if(!s||!bytes(s.mem,0x3000)||!bytes(s.km,0x3000)||!bytes(s.palExt,0x100)||
       !bytes(s.pal,0x100)||(s.dma===null)!==(s.dmaMask===null)||
       (s.dma!==null&&(!bytes(s.dma,0x200)||!bytes(s.dmaMask,0x200)))||
       !CK_SCALARS.every(k=>k in s.cpu)||!Number.isSafeInteger(s.frames)||
       s.frames<0||s.scroll?.length!==4||s.latch?.length!==8)
      throw Error('CK_STATE_INVALID');
    for(const k of CK_SCALARS)$[k]=s.cpu[k];
    $.st=s.st&&[...s.st];$.scroll=[...s.scroll];$.latch=[...s.latch];
    $.writes={...s.writes};
    mem.set(s.mem);km.set(s.km);palExt.set(s.palExt);pal.set(s.pal);
    $.dma=s.dma&&s.dma.slice();$.dmaMask=s.dmaMask&&s.dmaMask.slice();
    // Delivered records are never read back; only their count is kept.
    $.records.length=0;$.records.length=s.frames;
    restored=true;
  };
`;
const PATCHES=[
  ['  $.ramBytes=(a,n)=>({bytes:mem.slice(a,a+n),known:km.slice(a,a+n)});\n',
   '  $.ramBytes=(a,n)=>({bytes:mem.slice(a,a+n),known:km.slice(a,a+n)});\n'+STATE],
  ['  const reset=()=>{\n',
   '  const reset=()=>{\n    if(restored)return;\n'],
  ['  return {state:$,run};\n',
   '  return {state:$,run,exportState,importState};\n']
];
export function checkpointRuntime(source){
  let out=String(source);
  for(const [from,to] of PATCHES){
    const at=out.indexOf(from);
    // Fail closed if the runtime changed: never patch a guessed location.
    if(at<0||out.indexOf(from,at+1)>=0)throw Error('CK_RUNTIME_PATCH_ANCHOR');
    out=out.slice(0,at)+to+out.slice(at+from.length);
  }
  return out;
}
