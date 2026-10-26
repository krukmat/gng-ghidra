import {test} from 'node:test';
import assert from 'node:assert/strict';
import {b3Certified} from '../src/v3_b3_selection.mjs';
import {B3_PROFILES,B3_HORIZONS,b3Tape} from '../src/v3_b3_tapes.mjs';
const setup=()=>({
  parentManifest:{frames:1500,blocks:1654,files:{'program.mjs':'a'.repeat(64)}},
  manifest:{frames:6000,blocks:2266,files:{'program.mjs':'b'.repeat(64)}},
  report:{schema:'gng.v3.b3-playable.v1',status:'DISCOVERY_COMPLETE',
    no_input:'PASS_600_FRAMES_IDENTICAL_B2D',parent_profiles_unchanged:true,
    frozen_determinism:'PASS_2_RUNS_PER_PROFILE_EQUAL_DISCOVERY',
    parent_program_sha256:'a'.repeat(64),parent_blocks:1654,
    frozen_program_sha256:'b'.repeat(64),blocks:2266,live_frames:6000,
    profiles:Object.fromEntries(B3_PROFILES.map(p=>
      [p,{frames:B3_HORIZONS[p],tape_sha256:b3Tape(p).sha256}]))}
});
test('accepts an attested B3 child of B2-D',()=>{
  const x=setup();
  assert.equal(b3Certified(x.report,x.manifest,x.parentManifest),true);
});
test('an older generation with fewer, unchanged tapes stays selectable',()=>{
  const x=setup();
  delete x.report.profiles.sustainA;delete x.report.profiles.sustainB;
  assert.equal(b3Certified(x.report,x.manifest,x.parentManifest),true);
});
test('forged, partial or regressed reports are rejected',()=>{
  for(const mutate of [
    x=>x.report.status='BLOCKED',
    x=>x.report.parent_profiles_unchanged=false,
    x=>x.report.no_input='FAIL',
    x=>x.report.frozen_program_sha256='0'.repeat(64),
    x=>x.report.parent_program_sha256='0'.repeat(64),
    x=>x.report.parent_blocks=1600,
    x=>x.manifest.blocks=1654,
    x=>x.manifest.frames=1500,
    x=>delete x.report.profiles.titleCoinStart,
    x=>x.report.profiles.botA.tape_sha256='0'.repeat(64),
    x=>x.report.profiles.unknownTape={frames:6000,tape_sha256:'0'.repeat(64)},
    x=>x.report.profiles.arthurControls.frames=1000,
    x=>x.report.frozen_determinism='UNVERIFIED'
  ]){
    const x=setup();mutate(x);
    assert.equal(b3Certified(x.report,x.manifest,x.parentManifest),false);
  }
});
