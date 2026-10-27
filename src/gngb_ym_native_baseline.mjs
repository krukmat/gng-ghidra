/**
 * Read-only MAME audio tape comparison, never used as a YM synthesis source.
 * The stream stays private. The returned object contains aggregated chip
 * register-family counts and a window-relative first-event offset only.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import {YmRegisterHealth} from './gngb_ym_register_health.mjs';

export async function summarizeNativeYmRegisterWindow(
  tape,{windowTStates=3000000}={}
){
  if(typeof tape!=='string'||!Number.isSafeInteger(windowTStates)||
     windowTStates<1||windowTStates>3000000)
    throw Error('AUDIO_YM_NATIVE_BASELINE_BAD_ARGUMENTS');
  const stat=fs.lstatSync(tape);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024*1024)
    throw Error('AUDIO_YM_NATIVE_BASELINE_BAD_FILE');
  let releasedAt=null,resetsAsserted=0,releases=0,read=0,lastYm=-1;
  let firstRelative=null,inWindow=0,ymAfter=0;
  const health=new YmRegisterHealth();
  const input=fs.createReadStream(tape,{encoding:'utf8'});
  const lines=readline.createInterface({input,crlfDelay:Infinity});
  try {
    for await (const line of lines){
      if(!line.trim())continue;
      read++;
      if(read>1000000)throw Error('AUDIO_YM_NATIVE_BASELINE_EVENT_LIMIT');
      const evt=JSON.parse(line);
      if(!evt||!Number.isSafeInteger(evt.tick12m)||evt.tick12m<0||
         !Number.isInteger(evt.value)||evt.value<0||evt.value>255||
         !Number.isInteger(evt.address))
        throw Error('AUDIO_YM_NATIVE_BASELINE_BAD_ROW');
      if(evt.kind==='AUDIO_RESET_WRITE'){
        if(evt.address!==0x3d01||![0,1].includes(evt.value))
          throw Error('AUDIO_YM_NATIVE_BASELINE_BAD_RESET');
        if(evt.value===0)resetsAsserted++;
        else {releases++;if(releasedAt===null)releasedAt=evt.tick12m;}
      }else if(evt.kind==='YM2203_WRITE'){
        if(evt.address<0xe000||evt.address>0xe003||
           evt.tick12m<lastYm)
          throw Error('AUDIO_YM_NATIVE_BASELINE_BAD_YM');
        lastYm=evt.tick12m;
        if(releasedAt===null)continue;
        const relative=evt.tick12m-releasedAt;
        if(relative<0)continue;
        if(firstRelative===null)firstRelative=relative;
        ymAfter++;
        if(relative<windowTStates*4){
          health.accept(evt.address,evt.value);inWindow++;
        }
      }
    }
  }finally{lines.close();input.destroy();}
  if(releases!==1||resetsAsserted!==1||releasedAt===null)
    throw Error('AUDIO_YM_NATIVE_BASELINE_RESET_EPOCH_STOP');
  return Object.freeze({
    kind:'GNG_AUDIO_G5_PRIVATE_NATIVE_YM_BASELINE_V1',
    status:'AGGREGATE_COMPARISON_ONLY_NO_YM_TAPE_REPLAY',
    firstNativeYmTStateAfterRelease:firstRelative===null?null:
      Math.floor(firstRelative/4),
    ymNativePortWritesInWindow:inWindow,
    totalYmPortWritesAfterRelease:ymAfter,
    windowTStates,
    registerActivity:health.snapshot(),
    usedAsSynthesizerInput:false,
    nativeIrqParityVerified:false,
    rawYmDataExported:false
  });
}
