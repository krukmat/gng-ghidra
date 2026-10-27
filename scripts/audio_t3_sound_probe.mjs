#!/usr/bin/env node
/**
 * Local-private execution probe. NEVER prints ROM-derived code, PC lists,
 * register values, YM values or detailed errors.
 *
 * node scripts/audio_t3_sound_probe.mjs \
 *   --roots out/audio/z80-native-roots-b4trace1.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseZ80OperatorSeeds} from '../src/gngb_audio_frontier_report.mjs';
import {probeZ80SoundExecution} from '../src/gngb_z80_sound_probe.mjs';

const HASH='7ef9ec5c2072e21c787a6bbf700033f50c759c1d';
const BASE=path.resolve('out/audio');
function allowedPrivate(name) {
  if(!name?.startsWith('out/audio/')||name.includes('..')||
     name.includes('\\')||name.includes('\0'))
    throw Error('AUDIO_T3_PROBE_PRIVATE_PATH_REQUIRED');
  const loc=path.resolve(name);
  if(!loc.startsWith(BASE+path.sep)||!fs.statSync(loc).isFile()||
     fs.realpathSync(loc)!==loc)
    throw Error('AUDIO_T3_PROBE_PRIVATE_FILE_REQUIRED');
  return loc;
}
const permitted=new Set(['--roots','--target-tstates','--max-steps']);
function options(args) {
  if(args.length%2!==0 || args.length<2)
    throw Error('AUDIO_T3_PROBE_BAD_ARGUMENTS');
  const parsed={};
  for(let i=0;i<args.length;i+=2){
    if(!permitted.has(args[i])||Object.hasOwn(parsed,args[i]))
      throw Error('AUDIO_T3_PROBE_BAD_ARGUMENTS');
    parsed[args[i]]=args[i+1];
  }
  if(!parsed['--roots'])throw Error('AUDIO_T3_PROBE_ROOTS_REQUIRED');
  for(const [name,max] of [['--target-tstates',3000000],['--max-steps',1000000]]){
    if(parsed[name]!==undefined){
      if(!/^[1-9][0-9]*$/.test(parsed[name]) ||
         Number(parsed[name])>max)
        throw Error('AUDIO_T3_PROBE_BAD_NUMBER');
      parsed[name]=Number(parsed[name]);
    }
  }
  return parsed;
}
async function main() {
  try {
    const opt=options(process.argv.slice(2));
    const rom=fs.readFileSync(allowedPrivate('out/audio/gg2.bin'));
    if(rom.length!==0x8000||createHash('sha1').update(rom).digest('hex')!==HASH)
      throw Error('AUDIO_T3_PROBE_ROM_IDENTITY_STOP');
    const roots=parseZ80OperatorSeeds(fs.readFileSync(
      allowedPrivate(opt['--roots']),'utf8'));
    const summary=await probeZ80SoundExecution(new Uint8Array(rom),roots,{
      targetTStates:opt['--target-tstates']??12500,
      maxSteps:opt['--max-steps']??100000
    });
    // Positive whitelist only: never include private native trace, ROM or AOT.
    console.log(JSON.stringify({...summary,rom_sha1_match:true,
      private_artifacts_safe:true}));
    process.exitCode=summary.status==='LAB_ADVANCE_OK'?0:2;
  } catch {
    console.log(JSON.stringify({
      kind:'GNG_AUDIO_B4_T3_Z80_NATIVE_ROM_LAB_PROBE_V1',
      status:'STOP_SETUP_OR_COMPILE',
      reason:'AUDIO_T3_PROBE_SETUP_STOP',
      rom_bytes_exported:false,native_instruction_parity_verified:false,
      private_artifacts_safe:true
    }));
    process.exitCode=2;
  }
}
await main();
