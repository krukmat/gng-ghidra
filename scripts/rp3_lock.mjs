#!/usr/bin/env node
/** Derive a private RP-3 lock from RP-2 and verify the selected base copy. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {validateLock,validateRecipe,assertCompatible}
  from '../base/src/contracts/index.mjs';
import {verifyPinnedComponents} from '../base/src/build/verify-lock.mjs';
import {capabilities} from '../base/src/cpu/capabilities.mjs';

const [sourceArg,recipeArg,priorArg,outputArg]=process.argv.slice(2);
if(!sourceArg||!recipeArg||!priorArg||!outputArg)
  throw Error('RP3_LOCK_USAGE: base-repo rp1-recipe prior-lock private-output-dir');
const source=resolve(sourceArg),output=resolve(outputArg);
if(!output.startsWith(resolve('out')+'/'))throw Error('RP3_LOCK_PRIVATE_OUTPUT_REQUIRED');
const previous=validateLock(JSON.parse(readFileSync(resolve(priorArg)))),
  original=validateRecipe(JSON.parse(readFileSync(resolve(recipeArg))));
const git=(...args)=>execFileSync('git',['-C',source,...args]);
if(git('status','--porcelain').toString().trim())throw Error('RP3_BASE_DIRTY');
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const [path,expected] of Object.entries(previous.base.components))
  if(sha(git('show',`${previous.base.revision}:${path}`))!==expected)
    throw Error('RP3_PRIOR_LOCK_MISMATCH '+path);
const paths=[...new Set([...Object.keys(previous.base.components),
  'src/build/z80/compiler.mjs','src/cpu/z80/boundary.mjs',
  'src/cpu/z80/scheduler.mjs','src/cpu/z80/live-session.mjs',
  'src/audio/pcm-queue.mjs','src/audio/resampler.mjs',
  'src/host/web/pcm-worklet.mjs','src/host/web/frame-pacer.mjs',
  'src/host/web/engine-worker.mjs','src/host/web/audio-worker.mjs',
  'src/devices/ym2203/bank.cpp','src/devices/ym2203/wasm.mjs',
  'src/devices/ym2203/build.mjs',
  'templates/android/app/build.gradle.kts',
  'templates/android/app/src/main/AndroidManifest.xml',
  'templates/android/app/src/main/java/org/rommigration/shell/MainActivity.kt'])];
const revision=git('rev-parse','HEAD').toString().trim();
const lock={...previous,status:'rp3-ym-host',base:{revision,
  components:Object.fromEntries(paths.map(path=>
    [path,sha(git('show',`${revision}:${path}`))]))}};
validateLock(lock);verifyPinnedComponents(resolve('base'),lock);
// The RP-1 draft asked for NMI, but the actual GnG bus and IM1 scheduler
// implement IRQ only. Preserve that draft; record the supported derivation.
let originalResult='compatible';
try{assertCompatible(original,lock,capabilities);}catch(e){originalResult=e.message;}
if(originalResult!=='MIGRATION_INTERRUPT_UNSUPPORTED')
  throw Error('RP3_EXPECTED_RP1_NMI_REJECTION '+originalResult);
const recipe=validateRecipe({...original,status:'rp3-irq-supported',
  requirements:{...original.requirements,z80:{...original.requirements.z80,
    interrupts:['irq']}},
  note:'Derived from RP-1: the GnG sound bus has periodic IM1 IRQ; NMI is not implemented. Native integration and artifact build are still pending.'});
assertCompatible(recipe,lock,capabilities);
mkdirSync(output,{recursive:true,mode:0o700});
writeFileSync(join(output,'migration.json'),JSON.stringify(recipe,null,2)+'\n',
  {flag:'wx',mode:0o600});
writeFileSync(join(output,'migration.lock.json'),JSON.stringify(lock,null,2)+'\n',
  {flag:'wx',mode:0o600});
console.log(JSON.stringify({revision,components:paths.length,
  originalRecipe:originalResult,derivedRecipe:'compatible',output}));
