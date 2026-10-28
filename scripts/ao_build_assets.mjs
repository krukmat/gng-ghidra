#!/usr/bin/env node
/** AO-2: private Android WebView assets, built from the operator's ROM and
 * the newest certified B3 bundle with its audio overlay. Output goes to
 * out/android/assets (ignored by git); the APK made from it stays private.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,readdirSync,readFileSync,rmSync,statSync,
  writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {resumableRuntime} from '../src/ao_resumable_runtime.mjs';
import {packGfx} from '../src/ao_web_assets.mjs';
import {gngbGraphics} from './r35_t5_render_check.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
export const ASSETS=join(ROOT,'out/android/assets');
const WEB=join(ROOT,'android/web');
const BUNDLE_FILES=['program.mjs','mc6809_aot_lib.mjs','gngb_block_key.mjs',
  'code.bin','overlays.bin','manifest.json'];
// Worker entry points in src/; their relative imports are copied too.
const LIB_ENTRIES=['gngb_frame_renderer.mjs','gngb_render_inputs.mjs',
  'v2_b1_observable.mjs','gngb_input_contract.mjs','ao_web_assets.mjs',
  'ao_touch_controls.mjs','ao_game_state.mjs','v3_b2c_port_witness.mjs',
  'ao_audio_commands.mjs','ao_ym2203_wasm.mjs','gngb_audio_resampler.mjs'];
const AUDIO_WASM=join(ROOT,'out/android/audio');
const Z80_ROM_SHA1='7ef9ec5c2072e21c787a6bbf700033f50c759c1d';
const sha256=b=>createHash('sha256').update(b).digest('hex');

// A browser module may only import sibling modules: no node:, no packages.
function libClosure(entries){
  const seen=new Set(),queue=[...entries];
  while(queue.length){
    const name=queue.shift();
    if(seen.has(name))continue;
    seen.add(name);
    const text=readFileSync(join(ROOT,'src',name),'utf8');
    for(const m of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g)){
      const spec=m[1]??m[2];
      if(spec.startsWith('data:'))continue; // the Z80 session's generated code
      if(!/^\.\/[\w.-]+\.mjs$/.test(spec))
        throw Error('AO_ASSETS_NON_BROWSER_IMPORT '+name+' '+spec);
      queue.push(spec.slice(2));
    }
  }
  return [...seen].sort();
}
function listFiles(dir){
  return readdirSync(dir).flatMap(name=>{
    const path=join(dir,name);
    return statSync(path).isDirectory()?listFiles(path):[path];
  });
}
export async function buildAssets(){
  const selected=selectB3Bundle(ROOT);
  if(!selected)throw Error('AO_ASSETS_B3_BUNDLE_MISSING');
  const audio=await prepareAudioBundle(ROOT,selected.dir);
  const {manifest}=loadFrozen(audio.dir); // every asset SHA-256 checked
  rmSync(ASSETS,{recursive:true,force:true});
  for(const dir of ['bundle','lib','audio'])
    mkdirSync(join(ASSETS,dir),{recursive:true,mode:0o700});
  for(const name of BUNDLE_FILES)
    copyFileSync(join(audio.dir,name),join(ASSETS,'bundle',name));
  const runtime=resumableRuntime(readFileSync(join(audio.dir,'gngb_runtime.mjs'),'utf8'));
  writeFileSync(join(ASSETS,'bundle/gngb_runtime.mjs'),runtime,{mode:0o600});
  const zip=join(ROOT,'roms/gng.zip');
  const gfx=gngbGraphics(name=>execFileSync('unzip',['-p',zip,name],
    {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
  writeFileSync(join(ASSETS,'gfx.bin'),packGfx(gfx),{mode:0o600});
  // AO-6: Z80 ROM through the hash-checking extractor, and the AO-5 .wasm.
  execFileSync('python3',['scripts/audio_extract_sound_rom.py'],{cwd:ROOT,stdio:'ignore'});
  const z80=readFileSync(join(ROOT,'out/audio/gg2.bin'));
  if(createHash('sha1').update(z80).digest('hex')!==Z80_ROM_SHA1)
    throw Error('AO_ASSETS_Z80_ROM_INVALID');
  writeFileSync(join(ASSETS,'audio/gg2.bin'),z80,{mode:0o600});
  const wasm=readFileSync(join(AUDIO_WASM,'ym2203.wasm'));
  const build=JSON.parse(readFileSync(join(AUDIO_WASM,'build.json'),'utf8'));
  if(sha256(wasm)!==build.sha256)throw Error('AO_ASSETS_WASM_MISMATCH');
  writeFileSync(join(ASSETS,'audio/ym2203.wasm'),wasm,{mode:0o600});
  for(const name of libClosure(LIB_ENTRIES))
    copyFileSync(join(ROOT,'src',name),join(ASSETS,'lib',name));
  for(const name of readdirSync(WEB))
    copyFileSync(join(WEB,name),join(ASSETS,name));
  const files=Object.fromEntries(listFiles(ASSETS).sort().map(path=>
    [relative(ASSETS,path),sha256(readFileSync(path))]));
  const index={schema:'gng.ao.assets.v1',generation:selected.generation,
    program_sha256:manifest.files['program.mjs'],runtime_sha256:sha256(runtime),
    audio_wasm:build,files};
  writeFileSync(join(ASSETS,'assets.json'),JSON.stringify(index,null,2)+'\n',{mode:0o600});
  return index;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  buildAssets().then(index=>console.log('AO_ASSETS=PASS generation='+
    index.generation+' files='+Object.keys(index.files).length+
    ' dir=out/android/assets'))
    .catch(e=>{console.error('AO_ASSETS=BLOCKED_'+e.message);process.exitCode=2;});
}
