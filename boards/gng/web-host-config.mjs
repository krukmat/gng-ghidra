/** GnG timing, input and presentation policy supplied to the browser host. */
import {CYCLES_PER_FRAME,PORT_DEFAULTS} from './runtime.mjs';

const cpuHz=1500000,sourceSampleRate=62500;
export const GNG_WEB_HOST=Object.freeze({
  cpuHz,cyclesPerFrame:CYCLES_PER_FRAME,sourceSampleRate,
  samplesPerFrame:CYCLES_PER_FRAME*sourceSampleRate/cpuHz,
  leadFrames:8,maxBehindFrames:30,clockLostMs:250,startWaitMs:1000,
  maxAudioBacklog:120,heardCapacity:40,
  inputPortCount:PORT_DEFAULTS.length,width:256,height:224
});
