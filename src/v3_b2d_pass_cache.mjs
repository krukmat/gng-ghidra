/** Avoid replaying already completed discovery tapes on each AOT
 * expansion. This caches EVIDENCE only, never CPU state or rendered frames.
 * Exact frame/port-read hashes MUST be reattested against final frozen AOT.
 */
import {createHash} from 'node:crypto';
export function createB2DCoverageCache(profiles){
  if(!Array.isArray(profiles)||profiles.length===0||
     new Set(profiles).size!==profiles.length||
     profiles.some(p=>typeof p!=='string'||!p))
    throw Error('V3_B2D_CACHE_PROFILE_INVALID');
  const cached=new Map(),allowed=new Set(profiles);
  const fingerprint=(r,expected)=>{
    if(!r||r.result?.status!=='FRAMES_DONE'||
       !Array.isArray(r.hashes)||r.hashes.length!==expected||
       !r.hashes.every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))||
       !r.reads||typeof r.reads!=='object')
      throw Error('V3_B2D_CACHE_INVALID_REPLAY');
    return createHash('sha256')
      .update(JSON.stringify({hashes:r.hashes,reads:r.reads}))
      .digest('hex');
  };
  const checkProfile=profile=>{
    if(!allowed.has(profile))throw Error('V3_B2D_CACHE_PROFILE_INVALID');
  };
  return Object.freeze({
    has(profile){checkProfile(profile);return cached.has(profile)},
    get(profile){checkProfile(profile);return cached.get(profile)??null},
    remember(profile,run,expected){
      checkProfile(profile);
      if(cached.has(profile))throw Error('V3_B2D_CACHE_DUPLICATE');
      if(!Number.isSafeInteger(expected)||expected<1)
        throw Error('V3_B2D_CACHE_HORIZON_INVALID');
      const checksum=fingerprint(run,expected);
      cached.set(profile,Object.freeze({frames:expected,checksum}));
    },
    attest(profile,run,expected){
      checkProfile(profile);
      const proof=cached.get(profile);
      if(!proof||proof.frames!==expected||
         fingerprint(run,expected)!==proof.checksum)
        throw Error('V3_B2D_CACHE_FROZEN_DRIFT');
    }
  });
}
