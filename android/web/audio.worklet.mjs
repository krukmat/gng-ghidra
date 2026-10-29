/** GnG browser output entry. Source rate, queue and processor name belong to
 * this product; the output protocol and clock reporting live in the base.
 */
import {PCMStreamResampler} from './lib/gngb_audio_resampler.mjs';
import {createPCMWorkletProcessor} from './base/src/host/web/pcm-worklet.mjs';

registerProcessor('ao-pcm-sink',createPCMWorkletProcessor(PCMStreamResampler));
