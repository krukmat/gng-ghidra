#!/usr/bin/env node
/** Lab-only compiler from verified private gg2.bin. No runtime ROM decode. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compileZ80Prefix,Z80StaticError} from '../src/gngb_z80_static_codegen.mjs';

const romFile=process.argv[2]??'out/audio/gg2.bin';
const outFile=process.argv[3]??'out/audio/z80-prefix.mjs';
if(!outFile.startsWith('out/audio/')) {
  console.error('GNG_AUDIO_Z80=STOP_PRIVATE_OUTPUT_REQUIRED');process.exit(2);
}
try{
  const rom=fs.readFileSync(romFile);
  const sha1=createHash('sha1').update(rom).digest('hex');
  if(rom.length!==0x8000||sha1!=='7ef9ec5c2072e21c787a6bbf700033f50c759c1d')
    throw new Z80StaticError('AUDIO_Z80_ROM_IDENTITY_MISMATCH');
  const result=compileZ80Prefix(new Uint8Array(rom));
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  fs.writeFileSync(outFile,result.source);
  console.log(JSON.stringify({kind:'GNG_AUDIO_Z80_AOT_PREFIX_V1',status:result.status,
    compiled:result.compiled,unsupported:result.blockers.length,pending:result.pending,
    audio_working:false,has_native_parity:false}));
  // Fail closed until no unsupported opcode/path. Output is diagnostic only.
  if(result.status!=='SUPPORTED_PREFIX_ONLY')process.exitCode=2;
}catch(e){
  console.error(JSON.stringify({kind:'GNG_AUDIO_Z80_AOT_PREFIX_V1',
    status:'STOP',error:e instanceof Z80StaticError?e.code:'READ_OR_BUILD_FAILED'}));
  process.exitCode=2;
}
