/** GnG sound board adapter: 1.5 MHz main, 3 MHz Z80, 240 Hz IRQ. */
import {createZ80LiveSession as create,AudioLiveStop}
  from '../base/src/cpu/z80/live-session.mjs';
import {createZ80SoundBus,Z80_SOUND_HARDWARE}
  from './gngb_z80_sound_bus.mjs';
export {AudioLiveStop};
export function createZ80LiveSession(rom,options={}){
  if(!(rom instanceof Uint8Array)||rom.length!==0x8000)
    throw new AudioLiveStop('AUDIO_LIVE_CONFIG_INVALID');
  return create(rom,{createBus:createZ80SoundBus,
    irqPeriodTStates:Z80_SOUND_HARDWARE.z80IrqPeriodTStates,
    mainToZ80Ratio:Z80_SOUND_HARDWARE.z80Hz/Z80_SOUND_HARDWARE.mainHz,
    ...options});
}
