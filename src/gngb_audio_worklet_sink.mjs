/**
 * Browser-only PCM transport. Call resume() from a USER GESTURE due to autoplay.
 * No source is connected until Z80 AOT + YM2203 synthesis are native-validated.
 */
export async function createGngPCMOutput(context,{
  workletUrl='./gngb_audio_pcm_processor.mjs',onDiagnostic=()=>{}
}={}) {
  if(!context?.audioWorklet || typeof onDiagnostic!=='function')
    throw Error('AUDIO_WORKLET_UNSUPPORTED_OR_BAD_CALLBACK');
  await context.audioWorklet.addModule(workletUrl);
  const node=new AudioWorkletNode(context,'gng-pcm-sink',{
    numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
  node.port.onmessage=e=>onDiagnostic(e.data);
  node.connect(context.destination);
  return {
    node,
    push(samples) {
      if(!(samples instanceof Float32Array))
        throw Error('AUDIO_PCM_INPUT_INVALID');
      node.port.postMessage({kind:'PCM',samples});
    },
    reset(){node.port.postMessage({kind:'RESET'});},
    disconnect(){node.disconnect();}
  };
}
