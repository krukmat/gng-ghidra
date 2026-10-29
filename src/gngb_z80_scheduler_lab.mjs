/** GnG's 240 Hz sound IRQ period around the injected-bus Z80 scheduler. */
import {createZ80SchedulerLab as create}
  from '../base/src/cpu/z80/scheduler.mjs';
import {Z80_SOUND_HARDWARE} from './gngb_z80_sound_bus.mjs';
export {AudioZ80SchedulerStop} from '../base/src/cpu/z80/scheduler.mjs';
export function createZ80SchedulerLab(blocks,bus,options={}){
  return create(blocks,bus,{irqPeriodTStates:Z80_SOUND_HARDWARE.z80IrqPeriodTStates,
    interruptLineModel:'MAME_0288_HOLD_LINE_APPROXIMATION',
    ...options});
}
