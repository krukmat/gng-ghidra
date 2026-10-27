/**
 * G5/B-AUDIO-1: ROM-free bus contract. This is not a Z80 or YM2203 emulator.
 * Event timing uses the existing main-AOT scheduler (absolute 6809 cycles).
 * No audio is generated or played in this block.
 */
export const AUDIO_HARDWARE = Object.freeze({
  rom: 'gg2.bin', romBytes: 0x8000,
  romCrc32: '615f5b6f', romSha1: '7ef9ec5c2072e21c787a6bbf700033f50c759c1d',
  z80Hz: 3000000, ym2203Hz: 1500000, soundIrqHz: 240,
  mainSoundCommand: 0x3a00, mainSoundReset: 0x3d01,
  z80SoundLatch: 0xc800, z80Ym1: [0xe000, 0xe001],
  z80Ym2: [0xe002, 0xe003], z80Ram: [0xc000, 0xc7ff],
  mono: true,
});

/** Reject malformed or reordered event captures before using them as evidence. */
export function validateAudioTimeline(events, {cyclesPerFrame=25152}={}) {
  if (!Array.isArray(events) || !Number.isSafeInteger(cyclesPerFrame) || cyclesPerFrame < 1)
    throw Error('AUDIO_TIMELINE_INVALID');
  let lastCycle = -1;
  for (const e of events) {
    if (!e || typeof e !== 'object' ||
        !['SOUNDLATCH_WRITE', 'AUDIO_RESET_LINE'].includes(e.kind) ||
        !Number.isSafeInteger(e.cycle) || e.cycle < lastCycle ||
        !Number.isSafeInteger(e.frame) || e.frame !== Math.floor(e.cycle/cyclesPerFrame) ||
        !Number.isInteger(e.value) ||
        (e.kind === 'SOUNDLATCH_WRITE' ? e.value < 0 || e.value > 255 : e.value !== 0 && e.value !== 1))
      throw Error('AUDIO_TIMELINE_INVALID');
    lastCycle = e.cycle;
  }
  return {status:'ROM_FREE_CONTRACT_PASS',events:events.length,
    commands:events.filter(e=>e.kind==='SOUNDLATCH_WRITE').length,
    resets:events.filter(e=>e.kind==='AUDIO_RESET_LINE').length};
}
