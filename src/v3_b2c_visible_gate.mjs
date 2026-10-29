/** Operator-only VBlank gate: pauses the ORIGINAL MC6809 AOT CPU at
 * its first genuinely rendered frame, not at a fabricated game state.
 * A real Coin button press or explicit continue releases that VBlank.
 */
export function createVisibleFrameGate({armed=true}={}){
  let paused=false,firstVisible=null;
  return Object.freeze({
    shouldAdvance({index,known,coinHeld=false}){
      if(!Number.isSafeInteger(index)||index<1||typeof known!=='boolean'||
         typeof coinHeld!=='boolean')
        throw Error('V3_B2C_GATE_FRAME_INVALID');
      if(armed&&known){
        armed=false;firstVisible=index;
        paused=!coinHeld;
      }
      return !paused;
    },
    release(){
      const wasPaused=paused;paused=false;return wasPaused;
    },
    snapshot(){return Object.freeze({paused,firstVisible,armed});}
  });
}
