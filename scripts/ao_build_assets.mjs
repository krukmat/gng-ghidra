#!/usr/bin/env node
/** AO-2: private Android WebView assets, built from the operator's ROM and
 * the program bundle built by the base chain (base/tools/migrate.mjs build;
 * games/gngb/build.mjs). Output goes to out/android/assets (ignored by git);
 * the APK made from it stays private. Also the `package` hook of the build.
 */
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,readdirSync,readFileSync,rmSync,
  writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packGfx} from '../src/ao_web_assets.mjs';
import {validateRecipe} from '../base/src/contracts/index.mjs';
import {readRegions,readZipEntries} from '../base/src/build/input.mjs';
import {moduleClosure,fileIndex} from '../base/src/build/package.mjs';
import {checkBundle} from '../base/tools/migrate.mjs';
import {verifyInput,assertProgramMatches} from '../games/gngb/index.mjs';
import {gngCode} from '../boards/gng/bundle.mjs';
import {gngbGraphics} from './r35_t5_render_check.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
export const ASSETS=join(ROOT,'out/android/assets');
const WEB=join(ROOT,'android/web');
// Worker entry points in src/; their relative imports are copied too.
const LIB_ENTRIES=['gngb_frame_renderer.mjs','gngb_render_inputs.mjs',
  'v2_b1_observable.mjs','gngb_input_contract.mjs','ao_web_assets.mjs',
  'ao_touch_controls.mjs','ao_keyboard.mjs','games/gngb/state.mjs','v3_b2c_port_witness.mjs',
  'ao_stick.mjs','gngb_audio_producer.mjs','gngb_audio_resampler.mjs',
  'checkpoint_format.mjs','v3_b3_live_tape.mjs',
  'base/src/host/web/pcm-worklet.mjs','base/src/host/web/frame-pacer.mjs',
  'base/src/host/web/engine-worker.mjs','base/src/host/web/audio-worker.mjs',
  'boards/gng/web-host-config.mjs','boards/gng/bundle.mjs'];
// The YM2203 bank built from the pinned base copy (base/src/devices/ym2203).
const AUDIO_WASM=join(ROOT,'out/android/ym2203-bank');
// Private recipe of the current lock (scripts/rp3_lock.mjs) and the bundle
// built from it.
const RECIPE=resolve(ROOT,process.env.AO_RECIPE??'out/base-reference/rp4-v8/migration.json');
const BUNDLE=resolve(ROOT,process.env.AO_BUNDLE??'out/rp4/build/bundle');
const ROM_ZIP=join(ROOT,'roms/gng.zip');
const Z80_ROM_SHA1='7ef9ec5c2072e21c787a6bbf700033f50c759c1d';
const sha256=b=>createHash('sha256').update(b).digest('hex');

export async function buildAssets({bundleDir=BUNDLE,out=ASSETS}={}){
  // The recipe entry checks of createSession, at build time: the original
  // regions by ID, size and SHA-256, and the program built from them.
  const recipe=validateRecipe(JSON.parse(readFileSync(RECIPE,'utf8')));
  const original=new Uint8Array(readFileSync(ROM_ZIP));
  const input=await verifyInput(recipe,readRegions(recipe,original).regions);
  const bundle=checkBundle(bundleDir,recipe); // every file SHA-256 checked
  const {manifest}=bundle;
  assertProgramMatches(gngCode(manifest,bundle.files['code.bin'],
    bundle.files['overlays.bin']),input.regions);
  const members=readZipEntries(original);
  const unzip=name=>{
    if(!members[name])throw Error('AO_ASSETS_ZIP_MEMBER '+name);
    return members[name];
  };
  rmSync(out,{recursive:true,force:true});
  for(const dir of ['bundle','lib','audio'])
    mkdirSync(join(out,dir),{recursive:true,mode:0o700});
  for(const name of ['manifest.json',...Object.keys(manifest.files)])
    copyFileSync(join(bundleDir,name),join(out,'bundle',name));
  const gfx=gngbGraphics(unzip);
  writeFileSync(join(out,'gfx.bin'),packGfx(gfx),{mode:0o600});
  // AO-6: Z80 ROM from the verified recipe region, and the bank .wasm.
  const z80=input.regions.gg2;
  if(createHash('sha1').update(z80).digest('hex')!==Z80_ROM_SHA1)
    throw Error('AO_ASSETS_Z80_ROM_INVALID');
  writeFileSync(join(out,'audio/gg2.bin'),z80,{mode:0o600});
  const wasm=readFileSync(join(AUDIO_WASM,'ym2203.wasm'));
  const build=JSON.parse(readFileSync(join(AUDIO_WASM,'build.json'),'utf8'));
  if(sha256(wasm)!==build.sha256||build.source_sha256!==sha256(readFileSync(
    join(ROOT,'base/src/devices/ym2203/bank.cpp'))))
    throw Error('AO_ASSETS_WASM_MISMATCH');
  writeFileSync(join(out,'audio/ym2203.wasm'),wasm,{mode:0o600});
  const entries=[...LIB_ENTRIES,'boards/gng/runtime.mjs','boards/gng/code-view.mjs']
    .map(name=>name.includes('/')?name:'src/'+name);
  for(const name of moduleClosure(ROOT,entries,
    {allow:['src/','base/src/','boards/gng/','games/gngb/']})){
    const dest=join(out,name.replace(/^src\//,'lib/'));
    mkdirSync(dirname(dest),{recursive:true,mode:0o700});
    copyFileSync(join(ROOT,name),dest);
  }
  for(const name of readdirSync(WEB))
    copyFileSync(join(WEB,name),join(out,name));
  const files=fileIndex(out);
  const index={schema:'gng.ao.assets.v2',
    program_sha256:manifest.files['program.mjs'],
    recipe:{id:recipe.id,revision:input.revision,regions:recipe.binary.regions
      .map(({id,bytes,sha256})=>({id,bytes,sha256}))},
    audio_wasm:build,files};
  writeFileSync(join(out,'assets.json'),JSON.stringify(index,null,2)+'\n',{mode:0o600});
  return index;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  buildAssets().then(index=>console.log('AO_ASSETS=PASS program='+
    index.program_sha256.slice(0,16)+' files='+Object.keys(index.files).length+
    ' dir=out/android/assets'))
    .catch(e=>{console.error('AO_ASSETS=BLOCKED_'+e.message);process.exitCode=2;});
}
