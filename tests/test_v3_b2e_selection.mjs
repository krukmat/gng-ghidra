import {test} from 'node:test';
import assert from 'node:assert/strict';
import {b2eCertified} from '../src/v3_b2e_selection.mjs';
const setup=()=>({
  parentManifest:{frames:1500,blocks:1654,files:{'program.mjs':'a'.repeat(64)}},
  manifest:{frames:1500,blocks:1655,files:{'program.mjs':'b'.repeat(64)}},
  report:{schema:'gng.v3.b2e-idle-extension.v1',
    status:'DISCOVERY_COMPLETE',no_input:'PASS_1000_FRAMES_MATCH_B2D',
    frozen_determinism:'PASS_IDLE_1500_AND_PARENT_PROFILES_DOUBLE_REPLAY',
    parent_program_sha256:'a'.repeat(64),
    frozen_program_sha256:'b'.repeat(64),
    parent_blocks:1654,blocks:1655,idle_frames:1500,
    parent_profiles_unchanged:true}
});
test('accept a new attested idle-1500 bundle with old gameplay preserved',()=>{
 const {report,manifest,parentManifest}=setup();
 assert.equal(b2eCertified(report,manifest,parentManifest),true);
});
test('old B2D and made-up report cannot be promoted',()=>{
 const {report,manifest,parentManifest}=setup();
 manifest.blocks=1654;
 assert.equal(b2eCertified(report,manifest,parentManifest),false);
 manifest.blocks=1655;report.parent_profiles_unchanged=false;
 assert.equal(b2eCertified(report,manifest,parentManifest),false);
});
test('manifest mismatch, forged digest and false claims block selection',()=>{
 for(const mutate of [
   x=>x.manifest.frames=1000,
   x=>x.report.idle_frames=1000,
   x=>x.report.status='BLOCKED_ITERATION_LIMIT',
   x=>x.report.frozen_program_sha256='0'.repeat(64),
   x=>x.report.parent_program_sha256='0'.repeat(64),
   x=>x.report.parent_blocks=1700,
   x=>x.report.frozen_determinism='UNVERIFIED',
   x=>x.report.no_input='FAIL'
 ]){
   const x=setup();mutate(x);
   assert.equal(b2eCertified(x.report,x.manifest,x.parentManifest),false);
 }
});
