/**
 * Read-only MAME audio tape comparison, never used as a YM synthesis source.
 * The stream stays private. The returned object contains aggregated chip
 * register-family counts, first-event offset and optional sequence/timing counts.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import {YmRegisterHealth} from './gngb_ym_register_health.mjs';

export async function summarizeNativeYmRegisterWindow(
  tape,{windowTStates=3000000,generatedYm=null}={}
){
  if(typeof tape!=='string'||!Number.isSafeInteger(windowTStates)||
     windowTStates<1||windowTStates>36000000)
    throw Error('AUDIO_YM_NATIVE_BASELINE_BAD_ARGUMENTS');
  // Snapshot the optional generated stream before awaiting native tape I/O.
  // It remains private and is used only for comparison, never synthesis.
  let generated=null,generatedInWindow=0;
  if(generatedYm!==null){
    if(!Array.isArray(generatedYm)||generatedYm.length>200000)
      throw Error('AUDIO_YM_NATIVE_BASELINE_BAD_GENERATED_YM');
    let last=-1;
    generated=[];
    for(const row of generatedYm){
      if(!Array.isArray(row)||row.length!==3||
         !Number.isSafeInteger(row[0])||row[0]<0||row[0]<last||
         !Number.isInteger(row[1])||row[1]<0xe000||row[1]>0xe003||
         !Number.isInteger(row[2])||row[2]<0||row[2]>255)
        throw Error('AUDIO_YM_NATIVE_BASELINE_BAD_GENERATED_YM');
      last=row[0];
      if(row[0]<windowTStates*4)generatedInWindow++;
      generated.push([row[0],row[1],row[2]]);
    }
  }
  let commonPrefix=0,matchingPairs=0,firstDifferent=null;
  let firstTimingDifference=null,minSkew=null,maxSkew=null;
  const compareWrite=(index,relative,addr,value)=>{
    const row=index<generatedInWindow?generated[index]:null;
    const matches=row!==null&&row[1]===addr&&row[2]===value;
    if(!matches){
      if(firstDifferent===null)firstDifferent=index+1;
      return;
    }
    matchingPairs++;
    if(firstDifferent===null)commonPrefix++;
    const skew=row[0]-relative;
    minSkew=minSkew===null?skew:Math.min(minSkew,skew);
    maxSkew=maxSkew===null?skew:Math.max(maxSkew,skew);
    if(skew!==0&&firstTimingDifference===null)firstTimingDifference=index+1;
  };
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
          health.accept(evt.address,evt.value);
          if(generated!==null)compareWrite(inWindow,relative,evt.address,evt.value);
          inWindow++;
        }
      }
    }
  }finally{lines.close();input.destroy();}
  if(releases!==1||resetsAsserted!==1||releasedAt===null)
    throw Error('AUDIO_YM_NATIVE_BASELINE_RESET_EPOCH_STOP');
  if(generated!==null&&firstDifferent===null&&generatedInWindow!==inWindow)
    firstDifferent=Math.min(generatedInWindow,inWindow)+1;
  const sequenceComparison=generated===null?null:Object.freeze({
    status:'ORDINAL_PORT_WRITE_COMPARISON_ONLY_NOT_NATIVE_PARITY',
    ordinalBase:1,
    generatedPortWritesInWindow:generatedInWindow,
    nativePortWritesInWindow:inWindow,
    commonPortWritePrefix:commonPrefix,
    firstDifferentPortWriteOrdinal:firstDifferent,
    matchingOrdinalPortWritePairs:matchingPairs,
    firstTimingDifferenceOrdinal:firstTimingDifference,
    timingSkewUnit:'MASTER_12MHZ_TICKS_GENERATED_MINUS_NATIVE',
    matchingPairTimingSkewMin:minSkew,
    matchingPairTimingSkewMax:maxSkew,
    nativeParityVerified:false,
    rawYmDataExported:false
  });
  return Object.freeze({
    kind:'GNG_AUDIO_G5_PRIVATE_NATIVE_YM_BASELINE_V1',
    status:'AGGREGATE_COMPARISON_ONLY_NO_YM_TAPE_REPLAY',
    firstNativeYmTStateAfterRelease:firstRelative===null?null:
      Math.floor(firstRelative/4),
    ymNativePortWritesInWindow:inWindow,
    totalYmPortWritesAfterRelease:ymAfter,
    windowTStates,
    registerActivity:health.snapshot(),
    ...(sequenceComparison===null?{}:{sequenceComparison}),
    usedAsSynthesizerInput:false,
    nativeIrqParityVerified:false,
    rawYmDataExported:false
  });
}
