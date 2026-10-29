/** GnG audio half of the composed session: dated MC6809 sound events ->
 * Z80 session -> two YM2203 -> one mono PCM block per batch. The single
 * thread session and the browser audio worker use this same producer.
 */
import {createAudioCommandSource,applyCommand} from './ao_audio_commands.mjs';
import {createGngYm} from '../boards/gng/audio/ym2203.mjs';

const fail=code=>{const e=Error(code);e.code=code;throw e;};
export async function createGngAudioProducer({soundRom,wasm}){
  const source=await createAudioCommandSource(soundRom);
  const ym=await createGngYm(wasm);
  return Object.freeze({
    sampleRate:ym.sampleRate,
    // throughCycle is an exclusive MC6809 cycle frontier.
    batch(throughCycle,events){
      const {commands,stats}=source.batch(throughCycle,events);
      let block=null;
      for(const command of commands)block=applyCommand(ym,command)??block;
      if(!block)fail('GNG_AUDIO_PCM_MISSING');
      return {firstSample:block.firstSample,sampleRate:ym.sampleRate,
        samples:block.samples,stats:{ymWrites:stats.ymWrites,
          commands:stats.mainCommands,resetTransitions:stats.resetTransitions}};
    },
    // After a batch: Z80 session, queued events and both chips (GYM1).
    exportState:()=>({audio:source.exportState(),ym:ym.save()}),
    // Only on a fresh producer, before any batch.
    importState(state){source.importState(state.audio);ym.load(state.ym);},
    close(){ym.destroy();},
  });
}
