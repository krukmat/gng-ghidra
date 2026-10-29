/** GnG timing, input and presentation policy supplied to the browser host. */
import {CYCLES_PER_FRAME,PORT_DEFAULTS} from './runtime.mjs';
import {GNG_YM2203_SAMPLE_RATE} from './audio/ym2203.mjs';

const cpuHz=1500000,sourceSampleRate=GNG_YM2203_SAMPLE_RATE;
export const GNG_WEB_HOST=Object.freeze({
  cpuHz,cyclesPerFrame:CYCLES_PER_FRAME,sourceSampleRate,
  samplesPerFrame:CYCLES_PER_FRAME*sourceSampleRate/cpuHz,
  leadFrames:8,maxBehindFrames:30,clockLostMs:250,startWaitMs:1000,
  maxAudioBacklog:120,maxAudioEvents:5000,heardCapacity:40,
  inputPortCount:PORT_DEFAULTS.length,width:256,height:224
});
