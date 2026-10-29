import {PCMStreamResampler as BaseResampler}
  from '../base/src/audio/resampler.mjs';
export {AudioStreamStop} from '../base/src/audio/resampler.mjs';
export class PCMStreamResampler extends BaseResampler {
  constructor(outputRate,options={}){
    super(outputRate,{inputRate:62500,capacity:12500,prebuffer:3125,
      ...options});
  }
}
