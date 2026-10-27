#!/usr/bin/env node
/**
 * Local-only, ROM-verified multi-frontier scanner (G5-FAST B1).
 * No ROM bytes or ROM-derived AOT source are printed or persisted.
 * Additional PCs MUST be operator supplied; they are not auto-guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compileZ80Prefix} from '../src/gngb_z80_static_codegen.mjs';
import {summarizeZ80Frontiers,parseZ80OperatorSeeds} from '../src/gngb_audio_frontier_report.mjs';

const EXPECTED_SHA1='7ef9ec5c2072e21c787a6bbf700033f50c759c1d';
const ROOT=process.cwd();
const PRIVATE=path.resolve(ROOT,'out/audio');
const DEFAULTS={
  '--rom':'out/audio/gg2.bin',
  '--out':'out/audio/z80-frontier-report.json',
  '--limit':'4096',
  '--max-frontiers':'128',
  '--roots':null
};
function flags(argv) {
  const parsed={...DEFAULTS};
  for(let i=0;i<argv.length;i+=2) {
    const name=argv[i], value=argv[i+1];
    if(!Object.hasOwn(DEFAULTS,name)||value===undefined||parsed[name]!==DEFAULTS[name])
      throw Error('AUDIO_SCAN_BAD_ARGUMENT');
    parsed[name]=value;
  }
  return parsed;
}
function privatePath(p,writing=false) {
  if(typeof p!=='string'||!p.startsWith('out/audio/')||
     p.includes('\0')||p.includes('\\'))
    throw Error('AUDIO_SCAN_PRIVATE_PATH_REQUIRED');
  const resolved=path.resolve(ROOT,p);
  if(!resolved.startsWith(PRIVATE+path.sep))
    throw Error('AUDIO_SCAN_PRIVATE_PATH_REQUIRED');
  if(fs.existsSync(PRIVATE)&&fs.realpathSync(PRIVATE)!==PRIVATE)
    throw Error('AUDIO_SCAN_SYMLINK_PRIVATE_ROOT');
  if(!writing && fs.existsSync(resolved)&&fs.realpathSync(resolved)!==resolved)
    throw Error('AUDIO_SCAN_SYMLINK_PRIVATE_INPUT');
  if(writing) {
    const parent=path.dirname(resolved);
    if(parent!==PRIVATE || (fs.existsSync(resolved)&&fs.lstatSync(resolved).isSymbolicLink()))
      throw Error('AUDIO_SCAN_UNSAFE_OUTPUT_PATH');
  }
  return resolved;
}
function intArg(value,maximum) {
  if(!/^[1-9]\d*$/.test(value))throw Error('AUDIO_SCAN_BAD_LIMIT');
  const num=Number(value);
  if(!Number.isSafeInteger(num)||num>maximum)
    throw Error('AUDIO_SCAN_BAD_LIMIT');
  return num;
}
function run(argv) {
  const args=flags(argv);
  const romPath=privatePath(args['--rom']);
  const out=privatePath(args['--out'],true);
  const limit=intArg(args['--limit'],16384);
  const maxFrontiers=intArg(args['--max-frontiers'],256);
  const rom=fs.readFileSync(romPath);
  if(rom.length!==32768 || createHash('sha1').update(rom).digest('hex')!==EXPECTED_SHA1)
    throw Error('AUDIO_SCAN_ROM_IDENTITY_STOP');
  const entries=args['--roots']===null?[0]:
    parseZ80OperatorSeeds(fs.readFileSync(privatePath(args['--roots']),'utf8'));
  const result=compileZ80Prefix(new Uint8Array(rom),{entries,limit});
  // Explicit source whitelist: generated AOT source never enters this object.
  const report=summarizeZ80Frontiers(result,{
    limit,maxFrontiers,
    seedSource:args['--roots']===null?'RESET_VECTOR_ONLY':'OPERATOR_SUPPLIED_PCS'
  });
  if(!fs.existsSync(PRIVATE))throw Error('AUDIO_SCAN_PRIVATE_ROOT_MISSING');
  // The visited PC census is for PRIVATE native-trace comparison only.
  // Never place PC inventories or ROM-derived instructions in stdout.
  const privateAudit={...report,static_visited_pcs:result.visitedPcs};
  fs.writeFileSync(out,JSON.stringify(privateAudit,null,2)+'\n',{encoding:'utf8',flag:'w',mode:0o600});
  const short={
    kind:report.kind,status:report.status,rom_identity:report.rom_identity,
    static_decoded_pcs:report.static_decoded_pcs,
    static_frontiers_total:report.static_frontiers_total,
    pending_static_edges:report.pending_static_edges,
    truncated:report.truncated,
    seed_source:report.seed_source,
    families:report.families.slice(0,16),
    first_frontiers:report.frontiers.slice(0,12),
    report_written_private:true,
    native_trace_parity_verified:false,
    audio_working:false,
    instruction_bytes_exported:false
  };
  console.log(JSON.stringify(short));
  return report.status==='NO_STATIC_BLOCKER_NOT_CERTIFIED'?0:2;
}
try{
  process.exitCode=run(process.argv.slice(2));
}catch(err) {
  console.error(JSON.stringify({
    kind:'GNG_AUDIO_Z80_FRONTIER_SCAN_V1',status:'STOP',
    // Fail closed: no exception message, path, operand or ROM contents.
    error:'AUDIO_SCAN_INPUT_OR_RUNTIME_STOP',
    report_written_private:false,
    instruction_bytes_exported:false
  }));
  process.exitCode=2;
}
