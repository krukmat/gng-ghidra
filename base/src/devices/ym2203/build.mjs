#!/usr/bin/env node
/** Compile bank.cpp with a pinned ymfm checkout and Emscripten into a
 * standalone ym2203.wasm (no JS glue, threads, SharedArrayBuffer or
 * filesystem) plus build.json with the source, tool and output hashes.
 * Usage: node build.mjs <ymfm-checkout> <output-dir>; `emcc` comes from
 * PATH (or EMCC). ymfm is BSD-3-Clause: ship its notice with the binary.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const YMFM_REVISION='81aec25ccbb98f4873a255f7551ac4dadac59b4a';
export const EMCC_VERSION='4.0.15';
export const EXPORTS=['create','destroy','error','sample_rate','write',
  'reset','render','pcm','block_first','checkpoint','checkpoint_capacity',
  'save','load'].map(name=>'_ym2203_'+name);
const SOURCE=fileURLToPath(new URL('./bank.cpp',import.meta.url));
const sha256=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Error('YM2203_BUILD_'+code);};

export function buildYm2203Wasm(ymfmDir,outDir,{emcc=process.env.EMCC??'emcc'}={}){
  const ymfm=resolve(ymfmDir),out=resolve(outDir);
  let revision='';
  try{revision=execFileSync('git',['-C',ymfm,'rev-parse','HEAD'],
    {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
  if(revision!==YMFM_REVISION)fail('YMFM_PIN_MISMATCH '+revision);
  const version=/ (\d+\.\d+\.\d+) \(/.exec(execFileSync(emcc,['--version'],
    {encoding:'utf8'}).split('\n')[0])?.[1];
  if(version!==EMCC_VERSION)fail('EMCC_VERSION_MISMATCH '+version);
  mkdirSync(out,{recursive:true});
  const wasm=join(out,'ym2203.wasm');
  execFileSync(emcc,['-std=c++17','-O2','-Wall','-Wextra',
    '-Wno-unused-parameter','-fno-exceptions','-I'+join(ymfm,'src'),SOURCE,
    ...['ymfm_opn','ymfm_ssg','ymfm_adpcm','ymfm_misc'].map(name=>
      join(ymfm,'src',name+'.cpp')),
    '--no-entry','-sSTANDALONE_WASM','-sEXPORTED_FUNCTIONS='+EXPORTS.join(','),
    '-sINITIAL_MEMORY=2MB','-sSTACK_SIZE=64KB','-sALLOW_MEMORY_GROWTH=0',
    '-sFILESYSTEM=0','-sASSERTIONS=0','-o',wasm],{stdio:'inherit'});
  const bytes=readFileSync(wasm);
  const build={schema:'rom-migration.ym2203-wasm.v1',wasm:'ym2203.wasm',
    sha256:sha256(bytes),bytes:bytes.length,
    source_sha256:sha256(readFileSync(SOURCE)),emcc:version,ymfm:revision};
  writeFileSync(join(out,'build.json'),JSON.stringify(build,null,2)+'\n');
  return build;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [ymfm,out]=process.argv.slice(2);
  if(!ymfm||!out)fail('USAGE: build.mjs <ymfm-checkout> <output-dir>');
  console.log(JSON.stringify(buildYm2203Wasm(ymfm,out)));
}
