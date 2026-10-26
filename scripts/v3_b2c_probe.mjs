#!/usr/bin/env node
/** Probe the real live AOT server, not a rendered screenshot or a mock.
 * Only GET /state and GET /pixels over the fixed loopback address.
 */
import {inspectRealFrame} from '../src/v3_b2c_pixel_probe.mjs';
const BASE='http://127.0.0.1:18609';
async function main(){
  if(process.argv.slice(2).join(' ')!=='--probe')
    throw Error('V3_B2C_DIAG_ARGS_INVALID');
  const stateResp=await fetch(BASE+'/state',{cache:'no-store'});
  if(!stateResp.ok)throw Error('V3_B2C_DIAG_STATE_HTTP_'+stateResp.status);
  const s=await stateResp.json();
  if(s.mode!=='REAL_AOT'||!Number.isSafeInteger(s.sessionId))
    throw Error('V3_B2C_DIAG_NOT_REAL_ENGINE');
  console.log('V3_B2C_DIAG_BUNDLE_BLOCKS='+s.blocks);
  console.log('V3_B2C_DIAG_ENGINE_FRAME='+s.frame);
  console.log('V3_B2C_DIAG_HALTED='+String(s.halt?.status??'NO'));
  const response=await fetch(BASE+'/pixels',{cache:'no-store'});
  if(response.status===204){
    console.log('V3_B2C_DIAG_PIXELS=NOT_YET_AVAILABLE');return;
  }
  if(!response.ok)throw Error('V3_B2C_DIAG_FRAME_HTTP_'+response.status);
  const id=Number(response.headers.get('X-GnG-Frame'));
  const session=Number(response.headers.get('X-GnG-Session'));
  if(!Number.isSafeInteger(id)||id<1||session!==s.sessionId)
    throw Error('V3_B2C_DIAG_FRAME_METADATA_INVALID');
  const rgba=new Uint8Array(await response.arrayBuffer());
  const visual=inspectRealFrame(rgba);
  console.log('V3_B2C_DIAG_PIXEL_FRAME='+id);
  console.log('V3_B2C_DIAG_NONBLACK='+visual.nonBlackPixels);
  console.log('V3_B2C_DIAG_RGB_COLORS='+visual.rgbColors);
  console.log('V3_B2C_DIAG_NONOPAQUE='+visual.nonOpaquePixels);
  console.log('V3_B2C_DIAG_PIXELS='+(
    visual.nonOpaquePixels===0
    ?visual.allBlack?'REAL_ENGINE_OUTPUT_IS_BLACK':'PASS_NONBLACK_OPAQUE_RGBA'
    :'REAL_ENGINE_OUTPUT_HAS_ALPHA'));
}
main().catch(e=>{
  console.error('V3_B2C_DIAG=BLOCKED_'+String(e.message).replace(/^V3_B2C_/,''));
  process.exitCode=2;
});
