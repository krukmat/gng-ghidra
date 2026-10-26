/** V3.B3 promotion: a new frozen AOT child of certified B2-D that covers
 * the first playable route (Coin -> Start -> Arthur) with every B2-D
 * profile unchanged. Labels alone never select a bundle: report and
 * manifest digests must agree with the frozen assets.
 */
import {B3_CORE_PROFILES,B3_HORIZONS,b3Tape} from './v3_b3_tapes.mjs';
export function b3Certified(report,manifest,parentManifest){
  if(!report||!manifest||!parentManifest||
     report.schema!=='gng.v3.b3-playable.v1'||
     report.status!=='DISCOVERY_COMPLETE'||
     report.no_input!=='PASS_600_FRAMES_IDENTICAL_B2D'||
     report.parent_profiles_unchanged!==true||
     report.frozen_determinism!=='PASS_2_RUNS_PER_PROFILE_EQUAL_DISCOVERY'||
     report.parent_program_sha256!==parentManifest.files?.['program.mjs']||
     report.parent_blocks!==parentManifest.blocks||
     typeof report.frozen_program_sha256!=='string'||
     report.frozen_program_sha256!==manifest.files?.['program.mjs']||
     !Number.isInteger(manifest.blocks)||manifest.blocks<=parentManifest.blocks||
     report.blocks!==manifest.blocks||manifest.frames!==report.live_frames||
     !report.profiles||typeof report.profiles!=='object')
    return false;
  // Every certified tape must still be defined identically (hash), so a
  // stale report cannot vouch for tapes that have since changed.
  const names=Object.keys(report.profiles);
  if(!B3_CORE_PROFILES.every(p=>names.includes(p)))return false;
  return names.every(p=>{
    try{
      return report.profiles[p]?.frames===B3_HORIZONS[p]&&
        report.profiles[p].tape_sha256===b3Tape(p).sha256;
    }catch{return false;}
  });
}
