/** Local, ignored audio-capable copy of a certified frozen AOT bundle.
 * The selected program/code remains byte-identical. Never publish the copy.
 */
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,
  renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadFrozen,sha256,runFrozen} from './v2_b1_frozen.mjs';

// transform: optional runtime source patch (e.g. checkpointRuntime); the copy
// is keyed by the patched digest and verified against the selected bundle.
export async function prepareAudioBundle(root,selectedDir,{verifyFrames=2,
  transform=null}={}) {
  const original=loadFrozen(selectedDir).manifest;
  let runtime=readFileSync(join(root,'src/gngb_runtime.mjs'));
  if(transform)runtime=Buffer.from(transform(runtime.toString('utf8')),'utf8');
  const body=runtime.toString('utf8');
  if(!body.includes('onAudioEvent')||!body.includes('onAudioComplete'))
    throw Error('AUDIO_BUNDLE_OBSERVERS_MISSING');
  const digest=sha256(runtime);
  const base=join(root,'out/audio/live-bundles');
  mkdirSync(base,{recursive:true,mode:0o700});
  const dest=join(base,original.files['program.mjs'].slice(0,16)+'-'+digest.slice(0,16));
  if(!existsSync(dest)) {
    const temp=mkdtempSync(join(base,'.building-'));
    try {
      cpSync(selectedDir,temp,{recursive:true,force:true});
      writeFileSync(join(temp,'gngb_runtime.mjs'),runtime,{mode:0o600});
      const manifest={...original,files:{...original.files,
        'gngb_runtime.mjs':digest}};
      writeFileSync(join(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',
        {mode:0o600});
      loadFrozen(temp);
      renameSync(temp,dest);
    } finally {if(existsSync(temp))rmSync(temp,{recursive:true,force:true});}
  }
  const candidate=loadFrozen(dest).manifest;
  for(const [name,hash] of Object.entries(original.files))
    if(name!=='gngb_runtime.mjs'&&candidate.files[name]!==hash)
      throw Error('AUDIO_BUNDLE_CODE_CHANGED');
  if(candidate.files['gngb_runtime.mjs']!==digest)
    throw Error('AUDIO_BUNDLE_RUNTIME_STALE');
  const [before,after]=await Promise.all([
    runFrozen(selectedDir,{frames:verifyFrames}),
    runFrozen(dest,{frames:verifyFrames})
  ]);
  if(before.sequence_sha256!==after.sequence_sha256)
    throw Error('AUDIO_BUNDLE_FRAME_REGRESSION');
  return Object.freeze({dir:dest,programSha256:original.files['program.mjs'],
    runtimeSha256:digest,verifiedFrames:verifyFrames});
}
