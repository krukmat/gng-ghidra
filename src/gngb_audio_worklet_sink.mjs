/** Browser PCM transport. Caller creates/resumes context from a gesture. */
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
    push(packet) {
      if(!packet||!(packet.samples instanceof Int16Array))
        throw Error('AUDIO_PCM_INPUT_INVALID');
      node.port.postMessage({kind:'PCM',...packet},[packet.samples.buffer]);
    },
    reset(sessionId){node.port.postMessage({kind:'RESET',sessionId});},
    stop(){node.port.postMessage({kind:'STOP'});},
    disconnect(){node.disconnect();}
  };
}
