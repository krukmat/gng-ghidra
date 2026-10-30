/** Offline evaluator; frozen AOT, normal ports, read-only frame labels. */
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {createEvaluation} from './evaluation.mjs';
import {playerLabels} from '../games/gngb/state.mjs';

export async function loadEngine(root){
  const selected=selectB3Bundle(root);
  if(!selected||selected.generation!==4)throw Error('BOT_FROZEN_G4_REQUIRED');
  const {manifest,code}=loadFrozen(selected.dir);
  const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
  const {createBoard}=await import(pathToFileURL(join(selected.dir,'gngb_runtime.mjs')).href);
  const bundleHash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return {generation:selected.generation,bundleHash,run(events,{startFrame,endFrame,
      captureFrames=[]}={}){
    const schedule=defineInputSchedule(events),captures=new Map();
    const evaluation=createEvaluation({startFrame,checkpointEvery:100});
    const wanted=new Set(captureFrames),start=performance.now();
    let lastRecordHash=null;
    const board=createBoard(code,blocks,{frames:endFrame,
      portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
      onFrame:r=>{
        const frame=board.state.records.length;
        if(frame>=startFrame){
          const l=playerLabels(r);
          evaluation.observe({frame,world:l.world,y:l.y,lives:l.lives,
            stage:l.stage,known:l.known&&l.stageKnown});
        }
        if(wanted.has(frame))captures.set(frame,r);
        if(frame===endFrame)lastRecordHash=createHash('sha256').update(r.record)
          .update(r.known).update(JSON.stringify([r.scroll,r.bank,r.latch])).digest('hex');
        // Discard output records only; never write game/CPU state.
        board.state.records[frame-1]=null;
      }});
    const result=board.run();
    return {metrics:{...evaluation.finish({status:result.status,
      frames:board.state.records.length,pc:result.pc??null,bank:result.bank??null}),
      wallTimeMs:Math.round(performance.now()-start),lastRecordHash},captures};
  }};
}
