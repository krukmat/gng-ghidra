#!/usr/bin/env node
/**
 * G5 T3.7 passive BROWSER certification.
 * Run in a second terminal while Chrome is playing on localhost:18609.
 * Never drives controls, never reads ROM/PCM and never claims human audition.
 *
 * Stage 1: observe 120 continuous seconds with AudioWorklet PLAYING, no
 * missing frames, HTTP producer STOP, loss, duplicate, bad session or queue
 * overflow. Stage 2: operator presses real UI Restart, Coin, Start and leaves
 * browser playing; verify new session + worklet playback for 5 more seconds.
 */
import {performance} from 'node:perf_hooks';
import {browserAudioSnapshot,browserAudioReady,
  browserAudioContinuityStop}
  from '../src/gngb_audio_browser_certification.mjs';

const URI='http://127.0.0.1:18609/state';
const REQUIRED_MS=120000,START_TIMEOUT_MS=120000;
const RESET_TIMEOUT_MS=90000,POST_RESET_MS=5000;
const POLL_MS=400;
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));

async function getState(){
  const response=await fetch(URI,{cache:'no-store',
    signal:AbortSignal.timeout(2000)});
  if(!response.ok)throw Error('AUDIO_BROWSER_HTTP_STATE_STOP');
  return browserAudioSnapshot(await response.json());
}
async function main(){
  const report={kind:'GNG_AUDIO_G5_BROWSER_T37_CERT_V1',
    status:'STOP',reason:null,windowSeconds:120,
    liveBrowserWorkletVerified:false,humanAuditionConfirmed:false,
    resetVerified:false,pcmContinuityVerified:false,
    measuredAvWithinTarget:null};
  let stage='WAIT',from=null,prev=null,begun=performance.now();
  let origin=null,oldSession=null,resetStarted=null,resetPlaying=null;
  let samples=0,maxQueued=0,maxAbsAv=null,firstAv=null,lastAv=null;
  let avMeasurements=0;
  let maxGapMs=0,lastResponseAt=null;
  let response=null;
  try{
    for(;;){
      const now=performance.now();
      if(now-begun>START_TIMEOUT_MS&&stage==='WAIT')
        throw Error('AUDIO_BROWSER_WORKLET_START_TIMEOUT');
      if(stage==='RESET'&&now-resetStarted>RESET_TIMEOUT_MS)
        throw Error('AUDIO_BROWSER_COLD_RESET_TIMEOUT');
      let s;
      try{s=await getState();}
      catch(e){
        if(e?.message==='AUDIO_BROWSER_HTTP_STATE_STOP')throw e;
        if(stage!=='WAIT')throw Error('AUDIO_BROWSER_STATE_POLL_STOP');
        await sleep(POLL_MS);continue;
      }
      if(lastResponseAt!==null)
        maxGapMs=Math.max(maxGapMs,now-lastResponseAt);
      lastResponseAt=now;
      if(stage==='WAIT'){
        if(browserAudioReady(s)){
          stage='WINDOW';from=now;origin=s;prev=s;
          maxQueued=s.queued;oldSession=s.id;
          console.error('GNG_AUDIO_CERT=120S_WINDOW_STARTED session='+s.id);
        }
      }else if(stage==='WINDOW'){
        const failure=browserAudioContinuityStop(s,oldSession,prev);
        if(failure)throw Error(failure);
        maxQueued=Math.max(maxQueued,s.queued);
        if(Number.isFinite(s.avMs)){
          maxAbsAv=Math.max(maxAbsAv??0,Math.abs(s.avMs));
          if(firstAv===null)firstAv=s.avMs;
          lastAv=s.avMs;avMeasurements++;
        }
        samples++;prev=s;
        if(now-from>=REQUIRED_MS){
          if(s.out-origin.out<=0||s.delivered-origin.delivered<=0||
             s.nonzero-origin.nonzero<=0)
            throw Error('AUDIO_BROWSER_PCM_ACTIVITY_MISSING');
          report.measuredOutputSamples=s.out-origin.out;
          report.measuredDeliveredSamples=s.delivered-origin.delivered;
          report.measuredNonzeroSamples=s.nonzero-origin.nonzero;
          report.observations=samples;
          report.maxQueuedSamples=maxQueued;
          report.maxObservedQueueMs=Math.round(maxQueued/62.5*10)/10;
          report.maxAbsReportedAvMs=maxAbsAv;
          report.reportedAvDriftMs=(firstAv!==null&&lastAv!==null)?
            Math.abs(lastAv-firstAv):null;
          report.avTelemetryObservations=avMeasurements;
          // AV telemetry is estimated server-clock vs audio sample timestamp;
          // this is not a physically measured visual presentation timestamp.
          report.measuredAvWithinTarget=avMeasurements>=4?
            maxAbsAv<=100&&report.reportedAvDriftMs<=40:null;
          report.pcmContinuityVerified=true;
          stage='RESET';resetStarted=now;
          console.error('GNG_AUDIO_CERT=WINDOW_PASS_RESTART_NOW: click Reiniciar, then Coin and Start in Chrome');
        }
      }else if(stage==='RESET'){
        if(s.id>oldSession&&browserAudioReady(s)){
          if(resetPlaying===null){
            resetPlaying={time:now,out:s.out,id:s.id};
            console.error('GNG_AUDIO_CERT=NEW_SESSION_PLAYING session='+s.id);
          } else if(s.id===resetPlaying.id&&s.missing===0&&
                    s.out>resetPlaying.out&&
                    now-resetPlaying.time>=POST_RESET_MS){
            report.resetVerified=true;
            report.liveBrowserWorkletVerified=true;
            report.status=report.measuredAvWithinTarget===true?
              'BROWSER_TRANSPORT_PASS_AUDITION_PRESENTATION_PENDING':
              'BROWSER_TRANSPORT_PASS_AV_ESTIMATE_NOT_CLEARED';
            report.reason=report.measuredAvWithinTarget===true?
              null:'AUDIO_BROWSER_AV_ESTIMATE_NOT_CLEARED';
            break;
          }
        }
        if(s.stop||s.halted)
          throw Error('AUDIO_BROWSER_RESET_OR_ENGINE_STOP');
      }
      await sleep(POLL_MS);
    }
  }catch(e){
    report.reason=sanitizedCode(e?.message)??'AUDIO_BROWSER_UNEXPECTED_STOP';
  }
  report.maxHttpObservationGapMs=Math.round(maxGapMs);
  report.humanAuditionConfirmed=false; // never infer this from PCM telemetry
  report.audioNativeTimingParityVerified=false;
  report.privateArtifactsSafe=true;
  report.gameAudioFullyCertified=false; // A/V presentation + human audition pending
  console.log(JSON.stringify(report));
  if(report.status!=='BROWSER_TRANSPORT_PASS_AUDITION_PRESENTATION_PENDING')
    process.exitCode=2;
}
await main();
