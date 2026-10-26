/** Select a newly certified *private* AOT bundle, never inferred from
 * the mere existence of a directory or optimistic report labels.
 */
export function b2dCertified(report,manifest){
  if(!report||!manifest||
     report.schema!=='gng.v3.b2d-discovery.v1'||
     report.status!=='DISCOVERY_COMPLETE'||
     report.no_input!=='PASS_600_FRAMES_IDENTICAL_B2B_V2'||
     manifest.frames!==1500||!Number.isInteger(manifest.blocks)||
     manifest.blocks<=663||report.blocks!==manifest.blocks||
     typeof report.frozen_program_sha256!=='string'||
     report.frozen_program_sha256!==manifest.files?.['program.mjs']||
     !Array.isArray(report.profiles)||
     JSON.stringify(report.profiles)!==
       JSON.stringify(['lateControls','lateStart','lateCoin','idle','earlyControls'])||
     !(report.frozen_determinism==='PASS_2_RUNS_PER_PROFILE_HORIZON'&&
       JSON.stringify(report.profile_horizons)===
         JSON.stringify({lateControls:1500,lateStart:1500,lateCoin:1500,
           idle:1000,earlyControls:1000})||
       report.frozen_determinism==='PASS_2_RUNS_EACH_1500_FRAME_PROFILE'&&
       report.profile_horizons===undefined))
    return false;
  const fx=report.effects??{},reads=report.active??{};
  return ['coin','start','controls'].every(k=>
    Number.isInteger(fx[k])&&fx[k]>=1&&fx[k]<=1500)&&
    ['lateCoin','lateStart','lateControls'].every(k=>
      Number.isInteger(reads[k])&&reads[k]>0);
}
