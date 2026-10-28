#!/usr/bin/env node
/** Create a private draft GnG recipe and a contract-only fixed base lock. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [baseArg,zipArg,outputArg]=process.argv.slice(2);
if(!baseArg||!zipArg||!outputArg)throw Error('RP1_USAGE: base-repo rom-zip output-dir');
const base=resolve(baseArg),zip=resolve(zipArg),output=resolve(outputArg);
if(!output.startsWith(resolve('out')+'/'))throw Error('RP1_OUTPUT_MUST_BE_PRIVATE_OUT');
const {CONTRACT_VERSION,validateRecipe,validateLock}=await import(pathToFileURL(
  join(base,'src/contracts/index.mjs')).href);
const {verifyPinnedComponents}=await import(pathToFileURL(
  join(base,'src/build/verify-lock.mjs')).href);
const revision=execFileSync('git',['-C',base,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(execFileSync('git',['-C',base,'status','--porcelain'],{encoding:'utf8'}).trim())
  throw Error('RP1_BASE_DIRTY');
const sha256=b=>createHash('sha256').update(b).digest('hex');
const regions=['gg4.bin','gg3.bin','gg5.bin','gg2.bin'].map(id=>{
  const b=execFileSync('unzip',['-p',zip,id],{maxBuffer:1<<20});
  return {id:id.replace('.bin',''),entry:id,bytes:b.length,sha256:sha256(b)};
});
const recipe={schema:'rom-migration.project.v1',status:'draft',id:'gngb',
  cpu:{main:'mc6809',sound:'z80'},
  board:{id:'gng',module:'boards/gng/index.mjs'},
  game:{id:'gngb',module:'games/gngb/index.mjs'},
  binary:{kind:'zip',revision:'gngb',regions},
  devices:['ym2203'],platforms:['web','android'],
  scenarios:['cold-start-120','coin-start','arthur-controls','game-over-continue',
    'scroll-dma','audio-on-off'],
  requirements:{mc6809:{overlays:true,interrupts:['irq']},
    z80:{dynamicCode:true,interrupts:['irq','nmi']}},
  note:'Draft interface recipe. Board/game modules and build pipeline are RP-2 to RP-4 work.'};
const components=['src/contracts/index.mjs','src/build/verify-lock.mjs'];
const lock={schema:'rom-migration.lock.v1',status:'contract-only',
  contract:CONTRACT_VERSION,base:{revision,
    components:Object.fromEntries(components.map(path=>[path,
      sha256(readFileSync(join(base,path)))]))}};
validateRecipe(recipe);validateLock(lock);verifyPinnedComponents(base,lock);
mkdirSync(output,{recursive:true,mode:0o700});
writeFileSync(join(output,'migration.json'),JSON.stringify(recipe,null,2)+'\n',
  {flag:'wx',mode:0o600});
writeFileSync(join(output,'migration.lock.json'),JSON.stringify(lock,null,2)+'\n',
  {flag:'wx',mode:0o600});
console.log(JSON.stringify({recipe:join(output,'migration.json'),
  lock:join(output,'migration.lock.json'),baseRevision:revision,regions:regions.length}));
