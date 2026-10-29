#!/usr/bin/env node
/** Derive the private RP-2 lock from the pinned RP-1 lock and verify copies. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {validateLock,validateRecipe,assertCompatible}
  from '../base/src/contracts/index.mjs';
import {verifyPinnedComponents} from '../base/src/build/verify-lock.mjs';
import {capabilities} from '../base/src/cpu/capabilities.mjs';

const [sourceArg,recipeArg,oldLockArg,outputArg]=process.argv.slice(2);
if(!sourceArg||!recipeArg||!oldLockArg||!outputArg)
  throw Error('RP2_LOCK_USAGE: base-repo recipe prior-lock private-output-dir');
const source=resolve(sourceArg),output=resolve(outputArg);
if(!output.startsWith(resolve('out')+'/'))throw Error('RP2_LOCK_PRIVATE_OUTPUT_REQUIRED');
const recipe=validateRecipe(JSON.parse(readFileSync(resolve(recipeArg)))),
  previous=validateLock(JSON.parse(readFileSync(resolve(oldLockArg))));
const git=(...args)=>execFileSync('git',['-C',source,...args]);
if(git('status','--porcelain').toString().trim())throw Error('RP2_BASE_DIRTY');
const revision=git('rev-parse','HEAD').toString().trim();
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const [path,expected] of Object.entries(previous.base.components)){
  const pinned=git('show',`${previous.base.revision}:${path}`);
  if(sha(pinned)!==expected)throw Error('RP2_PRIOR_LOCK_MISMATCH '+path);
}
const names=[...Object.keys(previous.base.components),
  'src/build/mc6809/compiler.mjs','src/cpu/mc6809/alu.mjs',
  'src/cpu/mc6809/executor.mjs','src/cpu/capabilities.mjs'];
const lock={...previous,status:'rp2-mc6809',base:{revision,
  components:Object.fromEntries(names.map(path=>[path,sha(readFileSync(join(source,path)))]))}};
validateLock(lock);
verifyPinnedComponents(resolve('base'),lock);
const mainOnly={...recipe,cpu:{main:recipe.cpu.main},
  requirements:{mc6809:recipe.requirements.mc6809}};
assertCompatible(mainOnly,lock,capabilities);
let full='compatible';
try{assertCompatible(recipe,lock,capabilities);}catch(e){full=e.message;}
if(full!=='MIGRATION_CAPABILITIES_MISSING')
  throw Error('RP2_FULL_RECIPE_EXPECTED_Z80_BLOCK '+full);
mkdirSync(output,{recursive:true,mode:0o700});
writeFileSync(join(output,'migration.json'),JSON.stringify(recipe,null,2)+'\n',
  {flag:'wx',mode:0o600});
writeFileSync(join(output,'migration.lock.json'),JSON.stringify(lock,null,2)+'\n',
  {flag:'wx',mode:0o600});
console.log(JSON.stringify({revision,components:names.length,
  mc6809:'compatible',fullRecipe:full,output}));
