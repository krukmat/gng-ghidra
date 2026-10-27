/** Pixel-only policy harness over the existing frozen g4 engine, from reset.
 * onFrame F observes the boundary F*CPF-1; its P1 action starts at F*CPF.
 * Actions name HELD buttons (right_jump holds jump), not periodic macros.
 * RAM labels and requested frame records remain outside the policy channel.
 */
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {gngbGraphics,rendererInputs} from '../scripts/r35_t5_render_check.mjs';
import {createEvaluation} from './evaluation.mjs';

const CONTROLS=['p1.right','p1.left','p1.up','p1.down','p1.button1','p1.button2'];
const actionControls=action=>{
  if(typeof action!=='string'||
     !/^(neutral|stand|right|left|up|down)(_fire)?(_jump)?$/.test(action))
    throw Error('BOT_VISUAL_ACTION_INVALID');
  const desired=new Set(),direction=action.split('_')[0];
  if(['right','left','up','down'].includes(direction))desired.add('p1.'+direction);
  if(action.includes('_fire'))desired.add('p1.button1');
  if(action.includes('_jump'))desired.add('p1.button2');
  return desired;
};

export async function runVisualEpisode({root,events,startFrame,endFrame,
  decide,captureFrames=[]}={}){
  if(typeof root!=='string'||typeof decide!=='function'||
     !Number.isSafeInteger(startFrame)||startFrame<1||
     !Number.isSafeInteger(endFrame)||endFrame<=startFrame||endFrame>216000||
     !Array.isArray(captureFrames)||captureFrames.some(frame=>
       !Number.isSafeInteger(frame)||frame<1||frame>endFrame))
    throw Error('BOT_VISUAL_EPISODE_OPTIONS');
  const source=defineInputSchedule(events);
  const tape=source.events.filter(event=>event.cycle<startFrame*CYCLES_PER_FRAME);
  const held=new Set();
  for(const event of tape){
    if(event.pressed)held.add(event.control);else held.delete(event.control);
  }
  if([...held].some(control=>!CONTROLS.includes(control)))
    throw Error('BOT_VISUAL_PREFIX_SYSTEM_HELD');
  let schedule=defineInputSchedule(tape);
  const selected=selectB3Bundle(root);
  if(!selected||selected.generation!==4)throw Error('BOT_FROZEN_G4_REQUIRED');
  const {manifest,code}=loadFrozen(selected.dir);
  const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
  const {createBoard}=await import(pathToFileURL(join(selected.dir,'gngb_runtime.mjs')).href);
  const gfx=gngbGraphics(name=>execFileSync('unzip',
    ['-p',join(root,'roms/gng.zip'),name],
    {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
  const bundleHash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const evaluation=createEvaluation({startFrame}),captures=new Map(),decisions=[];
  const wanted=new Set(captureFrames),session='visual-g4-'+randomUUID();
  const started=performance.now();
  let lastRecordHash=null;
  const board=createBoard(code,blocks,{frames:endFrame,
    portRead:(address,cycle)=>readScheduledPort(schedule,address,cycle),
    onFrame:record=>{
      const frame=record.index;
      if(wanted.has(frame))captures.set(frame,record);
      if(frame>=startFrame){
        // Evaluation-only labels: never pass the record or board to decide.
        const bytes=record.record;
        const known=[0xa0,0xa1,0xa2,0xa3,0x60,0x52]
          .every(address=>record.known[address]===255);
        evaluation.observe({frame,world:bytes[0xa0]*256+bytes[0xa1],
          y:bytes[0xa2]*256+bytes[0xa3],lives:bytes[0x60],stage:bytes[0x52],known});
        if(frame<endFrame){
          if(rendererUnknownCount(record))throw Error('BOT_VISUAL_UNKNOWN_PIXELS');
          const {rgba,width,height}=renderGngbRgba(rendererInputs(bytes,
            {scroll:record.scroll,latch:record.latch},gfx));
          const decision=decide({frame,session,rgba,width,height});
          if(!decision||typeof decision!=='object'||typeof decision.then==='function')
            throw Error('BOT_VISUAL_DECISION_MUST_BE_SYNCHRONOUS');
          const desired=actionControls(decision.action);
          let changed=false;
          for(const control of CONTROLS){
            const pressed=desired.has(control);
            if(pressed===held.has(control))continue;
            tape.push({cycle:frame*CYCLES_PER_FRAME,control,pressed});
            if(pressed)held.add(control);else held.delete(control);
            changed=true;
          }
          if(changed)schedule=defineInputSchedule(tape);
          // Retain scalar diagnostics only, never RGBA, records or RAM arrays.
          const diagnostic=Object.fromEntries(Object.entries(decision).filter(([key,value])=>
            !['frame','session','rgba','pixels','ram','record','known','labels','memory','snapshot']
              .includes(key)&&
            (value===null||['string','boolean'].includes(typeof value)||
             (typeof value==='number'&&Number.isFinite(value)))));
          decisions.push({...diagnostic,frame,session});
        }
      }
      if(frame===endFrame)lastRecordHash=createHash('sha256')
        .update(record.record).update(record.known)
        .update(JSON.stringify([record.scroll,record.bank,record.latch])).digest('hex');
      // Discard output records only; no write to emulated memory or CPU state.
      board.state.records[frame-1]=null;
    }});
  const result=board.run();
  return {metrics:{...evaluation.finish({status:result.status,
    frames:board.state.records.length,pc:result.pc??null,bank:result.bank??null}),
    wallTimeMs:Math.round(performance.now()-started),lastRecordHash},
    events:defineInputSchedule(tape).events,decisions,captures,bundleHash,
    generation:selected.generation};
}
