/** Android app copy of the audio-capable runtime whose run(until) resumes
 * frame by frame: reset() happens on the first call only, and each call
 * returns after the VBlank of frame `until`. The browser worker can take
 * inputs between frames without SharedArrayBuffer or Atomics.wait.
 * The loop body is untouched; boundary() already moves T to the next frame.
 */
const PATCHES=[
  ['  const run=()=>{\n    reset();\n    for(;;){\n',
   '  let started=false;\n  const run=(until=frames)=>{\n'+
   '    if(!started){reset();started=true;}\n    for(;;){\n'],
  ["        if($.records.length>=frames)return {status:'FRAMES_DONE'};\n",
   "        if($.records.length>=until)return {status:'FRAMES_DONE'};\n"]
];
export function resumableRuntime(source){
  let out=String(source);
  for(const [from,to] of PATCHES){
    const at=out.indexOf(from);
    // Fail closed if the runtime changed: never patch a guessed location.
    if(at<0||out.indexOf(from,at+1)>=0)throw Error('AO_RUNTIME_PATCH_ANCHOR');
    out=out.slice(0,at)+to+out.slice(at+from.length);
  }
  return out;
}
