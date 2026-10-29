/** GnG sound-ROM shape around the pinned generic Z80 prefix compiler. */
import {compileZ80Prefix as compile, Z80StaticError}
  from '../base/src/build/z80/compiler.mjs';
export {Z80StaticError,classifyZ80Family,classifyZ80EdInstruction,
  classifyZ80IndexedInstruction,classifyZ80CbInstruction}
  from '../base/src/build/z80/compiler.mjs';
export function compileZ80Prefix(rom,options){
  if(!(rom instanceof Uint8Array)||rom.length!==0x8000)
    throw new Z80StaticError('AUDIO_Z80_ROM_INVALID');
  return compile(rom,options);
}
