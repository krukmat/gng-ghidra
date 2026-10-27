/**
 * B4.T1 — ROM-free bridge from MC6809 board onAudioEvent to the existing
 * Z80 sound-bus interface. Transport of controls only, NOT CPU execution.
 *
 * Wiring:
 *   const bridge=createGngbMainZ80Bridge(soundRom,{onYmWrite,onReset});
 *   createBoard(code,blocks,{...,onAudioEvent:bridge.onAudioEvent});
 *
 * No change to MC6809 engine/bot, no YM synthesis and no automatic IRQ.
 * Live audio MUST NOT be declared working until a separately validated
 * Z80 scheduler and real-time YM2203 PCM producer are connected.
 */
import {createZ80SoundBus,Z80_SOUND_HARDWARE} from './gngb_z80_sound_bus.mjs';

export class GngbAudioBridgeStop extends Error {
  constructor(code){super(code);this.code=code;}
}
export function createGngbMainZ80Bridge(soundRom,{
  mainCycleAnchor=0,masterTickAnchor=0,onYmWrite=null,onReset=null
}={}) {
  const bus=createZ80SoundBus(soundRom,{
    mainCycleAnchor,masterTickAnchor,onYmWrite,onReset
  });
  let lastCycle=-1,commandCount=0,resetCount=0;
  const onAudioEvent=e=>{
    if(!e||typeof e!=='object'||
      !['SOUNDLATCH_WRITE','AUDIO_RESET_LINE'].includes(e.kind)||
      !Number.isSafeInteger(e.cycle)||e.cycle<mainCycleAnchor||
      e.cycle<lastCycle||!Number.isInteger(e.value)||
      e.value<0||e.value>255||
      (e.kind==='AUDIO_RESET_LINE'&&e.value>1))
      throw new GngbAudioBridgeStop('B4_MAIN_AUDIO_EVENT_INVALID');
    // 6809 board's observer provides a frame and PC. They are diagnostic,
    // not used as a fake instruction source for the sound CPU.
    if(e.frame!==undefined&&(!Number.isSafeInteger(e.frame)||e.frame<0))
      throw new GngbAudioBridgeStop('B4_MAIN_AUDIO_FRAME_INVALID');
    if(e.pc!==undefined&&(!Number.isSafeInteger(e.pc)||e.pc<0||e.pc>65535))
      throw new GngbAudioBridgeStop('B4_MAIN_AUDIO_PC_INVALID');
    const translated=bus.applyMainEvent({kind:e.kind,cycle:e.cycle,value:e.value});
    lastCycle=e.cycle;
    if(e.kind==='SOUNDLATCH_WRITE')commandCount++;
    else resetCount++;
    return translated;
  };
  const snapshot=()=>Object.freeze({
    kind:'GNG_B4_MAIN_Z80_BRIDGE_V1',
    status:'MAIN_BUS_EVENTS_ONLY_Z80_NOT_EXECUTING',
    mainSoundCommandsObserved:commandCount,
    mainResetTransitionsObserved:resetCount,
    soundLatchValue:bus.soundLatch,
    z80InReset:bus.resetAsserted,
    masterTicksPerMainCycle:Z80_SOUND_HARDWARE.masterTicksPerMain,
    schedulerRunning:false,
    periodicIrq240HzServiced:false,
    ymSynthesizerConnected:false,
    pcmGenerated:false,
    browserAudioWorking:false,
    nativeTimingParityVerified:false
  });
  return Object.freeze({bus,onAudioEvent,snapshot});
}
