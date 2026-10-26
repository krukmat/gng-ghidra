/** V3.B2E promotion: only a *new* authenticated frozen AOT program
 * extending idle coverage while preserving B2D's previously verified
 * Coin/Start/controls gameplay. No state injection or graphics substitution.
 */
export function b2eCertified(report,manifest,parentManifest){
  if(!report||!manifest||!parentManifest||
     report.schema!=='gng.v3.b2e-idle-extension.v1'||
     report.status!=='DISCOVERY_COMPLETE'||
     report.no_input!=='PASS_1000_FRAMES_MATCH_B2D'||
     report.frozen_determinism!=='PASS_IDLE_1500_AND_PARENT_PROFILES_DOUBLE_REPLAY'||
     report.parent_program_sha256!==parentManifest.files?.['program.mjs']||
     typeof report.frozen_program_sha256!=='string'||
     report.frozen_program_sha256!==manifest.files?.['program.mjs']||
     report.parent_blocks!==parentManifest.blocks||
     !Number.isInteger(manifest.blocks)||manifest.blocks<=parentManifest.blocks||
     report.blocks!==manifest.blocks||manifest.frames!==1500||
     report.idle_frames!==1500||
     report.parent_profiles_unchanged!==true)
    return false;
  return true;
}
