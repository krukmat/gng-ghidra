/** Laboratory-only checkpointing of a verified frozen board runtime.
 * The frozen file is read and instrumented in memory; no bundle or product
 * runtime is changed. The adapter never decodes MC6809 instructions.
 */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const replaceOnce=(source,from,to)=>{
  const first=source.indexOf(from);
  if(first<0||source.indexOf(from,first+1)>=0)
    throw Error('V3_B3_LAB_RUNTIME_SHAPE_CHANGED');
  return source.slice(0,first)+to+source.slice(first+from.length);
};

/** Instrument only the exact, manifest-verified runtime supplied by caller. */
export async function labCreateBoard(runtimePath,expectedSha256,code,blocks,options={}){
  if(!Number.isSafeInteger(options.frames)||options.frames<1)
    throw Error('V3_B3_LAB_FRAMES_INVALID');
  const original=readFileSync(runtimePath);
  const digest=createHash('sha256').update(original).digest('hex');
  if(digest!==expectedSha256)throw Error('V3_B3_LAB_RUNTIME_HASH_MISMATCH');
  let source=original.toString('utf8');
  const base=runtimePath.slice(0,runtimePath.lastIndexOf('/')+1);
  for(const name of ['mc6809_aot_lib.mjs','gngb_block_key.mjs'])
    source=replaceOnce(source,`'./${name}'`,`'${pathToFileURL(join(base,name)).href}'`);
  source=replaceOnce(source,'  const run=()=>{\n    reset();',
    '  let started=false,frameLimit=frames;\n  const run=()=>{\n    if(!started){reset();started=true;}');
  source=replaceOnce(source,'if($.records.length>=frames)return',
    'if($.records.length>=frameLimit)return');
  source=replaceOnce(source,'  return {state:$,run};',`  const hardwareKeys=[
    'a','b','dp','x','y','u','s','cc','PC',
    'ka','kb','kdp','kx','ky','ku','ks','kcc',
    'C','T','st','ipc','lk','irq','sync','bank','scroll','latch',
    'soundlatch','dma','dmaMask','snapped','frame','writes'
  ];
  const save=()=>({
    hardware:Object.fromEntries(hardwareKeys.map(k=>[k,structuredClone($[k])])),
    mem:mem.slice(),km:km.slice(),palExt:palExt.slice(),pal:pal.slice(),
    started,recordCount:$.records.length,eventCount:$.events.length,
    misses:[...misses]
  });
  const restore=s=>{
    if(!s||s.mem?.length!==mem.length||s.km?.length!==km.length||
       s.palExt?.length!==palExt.length||s.pal?.length!==pal.length||
       !Number.isSafeInteger(s.recordCount)||!Number.isSafeInteger(s.eventCount))
      throw Error('V3_B3_LAB_SNAPSHOT_INVALID');
    mem.set(s.mem);km.set(s.km);palExt.set(s.palExt);pal.set(s.pal);
    for(const k of hardwareKeys)$[k]=structuredClone(s.hardware[k]);
    $.records.length=s.recordCount;$.events.length=s.eventCount;
    misses.clear();for(const key of s.misses)misses.add(key);
    started=s.started;
  };
  const advanceTo=n=>{
    if(!Number.isSafeInteger(n)||n<1||n<=$.records.length)
      throw Error('V3_B3_LAB_FRAME_TARGET_INVALID');
    frameLimit=n;
    return run();
  };
  return {state:$,run,lab:{save,restore,advanceTo}};`);
  // The generated module exists only in memory and imports the original
  // frozen ALU/key modules. No private code or board state is written out.
  const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');
  const {createBoard}=await import(url);
  return createBoard(code,blocks,options);
}
