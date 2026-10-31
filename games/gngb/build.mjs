/** gngb project hooks for the base build commands (base/tools/migrate.mjs).
 * GnG owns the code image layout, the code view, the strategy settings, the
 * discovery scenario and the RAM code locator; the base runs them.
 *
 *   node base/tools/migrate.mjs build --recipe R --input roms/gng.zip \
 *     --project games/gngb/build.mjs --out out/rp4/build-<tag>
 */
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {verifyInput} from './index.mjs';
import {gngbCodeImage} from './code-image.mjs';
import {createGngCodeView} from '../../boards/gng/code-view.mjs';
import {createBoard} from '../../boards/gng/runtime.mjs';
import {locateRamCode,currentOverlay} from '../../boards/gng/ram-code.mjs';
import {gngCode} from '../../boards/gng/bundle.mjs';

export const DISCOVERY_FRAMES=6000;
const fail=code=>{throw Error('GNGB_BUILD_'+code);};

/** One no-input run from reset; a miss yields the seed to compile. */
function idleScenario(code,view,frames){
  return {name:'idle-'+frames,run(blocks){
    const board=createBoard(code,blocks,{frames,
      onFrame:r=>{board.state.records[r.index-1]=null;}});
    const r=board.run();
    if(r.status==='FRAMES_DONE')return {done:true,summary:{frames}};
    if(r.status!=='CODE_UNMAPPED'&&r.status!=='UNCOMPILED')
      return {reason:r.status+'_'+r.pc};
    if(r.pc<0x3000){
      let id=currentOverlay(code,board.state,r.pc);
      if(id<0){
        const ov=locateRamCode(code,board.state,r.pc);
        if(!ov)return {reason:'RAM_ORIGIN_UNRESOLVED_'+r.pc};
        id=code.ramOverlays.push(ov)-1;
      }
      return {seed:view.at(r.pc,null,id)};
    }
    const seed=view.at(r.pc,board.state.bank);
    return seed?{seed}:{reason:'UNMAPPED_'+r.pc};
  }};
}

export async function prepare({recipe,regions}){
  const input=await verifyInput(recipe,regions);
  const code=gngbCodeImage(name=>input.regions[name.replace('.bin','')]);
  code.ramOverlays=[];
  const view=createGngCodeView(code);
  return {architecture:'mc6809',view,
    strategies:{boot:view.at(0xfffe,null),vectors:true,flow:true,
      jumpTables:{maxEntries:128,lookback:12},immediates:{table:64}},
    scenarios:[idleScenario(code,view,DISCOVERY_FRAMES)],
    data:()=>({'code.bin':Uint8Array.from([...code.fixed,...code.banks]),
      'overlays.bin':Uint8Array.from(code.ramOverlays.flatMap(ov=>[...ov.bytes]))}),
    meta:()=>{
      let offset=0;
      return {layout:'gng.code-image.v1',overlays:code.ramOverlays.map(ov=>{
        const d={start:ov.start,length:ov.bytes.length,offset};
        offset+=ov.bytes.length;return d;
      })};
    }};
}

/** The bundle runs 600 no-input frames without a miss. */
export async function validate({bundle,bundleDir}){
  const code=gngCode(bundle.manifest,bundle.files['code.bin'],bundle.files['overlays.bin']);
  const {blocks}=await import(pathToFileURL(join(bundleDir,'program.mjs')).href);
  if(blocks.size!==bundle.manifest.program.blocks)fail('BLOCK_COUNT');
  const board=createBoard(code,blocks,{frames:600,
    onFrame:r=>{board.state.records[r.index-1]=null;}});
  const r=board.run();
  if(r.status!=='FRAMES_DONE')fail('RUN_'+r.status+'_'+r.pc);
  return {frames:600,status:r.status,cycle:board.state.C};
}

export async function package_({bundleDir,out}){
  const {buildAssets}=await import('../../scripts/ao_build_assets.mjs');
  const index=await buildAssets({bundleDir,out});
  return {out,files:Object.keys(index.files).length,program_sha256:index.program_sha256};
}
export {package_ as package};
