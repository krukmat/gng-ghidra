import {test} from 'node:test';
import assert from 'node:assert/strict';
import {b2dCertified} from '../src/v3_b2d_selection.mjs';
const setup=()=>({
  manifest:{frames:1500,blocks:700,files:{'program.mjs':'a'.repeat(64)}},
  report:{schema:'gng.v3.b2d-discovery.v1',
    status:'DISCOVERY_COMPLETE',blocks:700,
    no_input:'PASS_600_FRAMES_IDENTICAL_B2B_V2',
    frozen_determinism:'PASS_2_RUNS_PER_PROFILE_HORIZON',
    frozen_program_sha256:'a'.repeat(64),
    profiles:['lateControls','lateStart','lateCoin','idle','earlyControls'],
    profile_horizons:{lateControls:1500,lateStart:1500,lateCoin:1500,idle:1000,earlyControls:1000},
    effects:{coin:814,start:852,controls:902},
    active:{lateCoin:4,lateStart:5,lateControls:10}}
});
test('accept exactly certified expanded AOT, not a fake UI report',()=>{
 const {report,manifest}=setup();
 assert.equal(b2dCertified(report,manifest),true);
});
test('reject incomplete, unproven and relabelled programs',()=>{
 for(const mod of [
  r=>r.status='CANDIDATE_COMPLETE',
  r=>r.effects.start=null,
  r=>r.active.lateCoin=0,
  r=>r.frozen_program_sha256='b'.repeat(64),
  r=>r.frozen_determinism='NOT_VERIFIED',
  r=>r.profiles=['lateControls'],
 ]){
   const {report,manifest}=setup();mod(report);
   assert.equal(b2dCertified(report,manifest),false);
 }
});
test('manifest hash, frame count and block count must agree',()=>{
 for(const mutate of [
   m=>m.frames=1000,m=>m.blocks=663,
   m=>m.blocks=703,m=>m.files['program.mjs']='b'.repeat(64)
 ]){
   const {report,manifest}=setup();mutate(manifest);
   assert.equal(b2dCertified(report,manifest),false);
 }
});

test('idle 1500 is not incorrectly claimed and profile horizons are obligatory',()=>{
  const {report,manifest}=setup();
  report.profile_horizons.idle=1500;
  assert.equal(b2dCertified(report,manifest),false);
  report.profile_horizons.idle=1000;
  delete report.profile_horizons;
  assert.equal(b2dCertified(report,manifest),false);
});
