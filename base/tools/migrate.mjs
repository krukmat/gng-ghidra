#!/usr/bin/env node
/** Migration commands; every input is an explicit argument.
 *
 *   verify   --recipe R --input F
 *   build    --recipe R --input F --project P --out DIR
 *   validate --recipe R --input F --bundle B [--project P]
 *   package  --recipe R --input F --project P --bundle B --out DIR
 *
 * The project module P exports `prepare({recipe, regions})` for build, and
 * optionally `validate(...)` and `package(...)`. `prepare` returns
 * `{architecture, view, strategies, scenarios, data(), meta()}`: the code
 * view, the enabled static strategies (discover.mjs), the run-time discovery
 * scenarios (discover-run.mjs) and the data files the program needs.
 * `build` writes DIR/bundle (bundle.mjs) and DIR/report.json; DIR must not
 * exist. Output is JSON on stdout; errors exit 2 with `MIGRATE=BLOCKED_...`.
 */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateRecipe} from '../src/contracts/index.mjs';
import {readRegions} from '../src/build/input.mjs';
import {compileProgram} from '../src/build/mc6809/compiler.mjs';
import {discoverStatic} from '../src/build/mc6809/discover.mjs';
import {discoverAtRuntime} from '../src/build/discover-run.mjs';
import {readBundle,writeBundle} from '../src/build/bundle.mjs';

const BASE=resolve(fileURLToPath(import.meta.url),'../..');
const ALU=join(BASE,'src/cpu/mc6809/alu.mjs');
const TOOLS=['tools/migrate.mjs','src/build/input.mjs','src/build/mc6809/compiler.mjs',
  'src/build/mc6809/discover.mjs','src/build/discover-run.mjs','src/build/bundle.mjs',
  'src/cpu/mc6809/alu.mjs'];
const fail=code=>{throw Error('MIGRATE_'+code);};
const sha256=b=>createHash('sha256').update(b).digest('hex');
const COMMANDS={verify:['recipe','input'],build:['recipe','input','project','out'],
  validate:['recipe','input','bundle'],package:['recipe','input','project','bundle','out']};

export function parseArgs(argv){
  const [command,...rest]=argv;
  if(!COMMANDS[command])fail('USAGE');
  const opts={};
  for(let i=0;i<rest.length;i+=2){
    const k=rest[i]?.replace(/^--/,'');
    if(!rest[i]?.startsWith('--')||rest[i+1]===undefined||k in opts)fail('USAGE');
    opts[k]=rest[i+1];
  }
  const allowed=[...COMMANDS[command],'project'];
  for(const k of Object.keys(opts))if(!allowed.includes(k))fail('UNKNOWN_OPTION_'+k);
  for(const k of COMMANDS[command])if(!opts[k])fail('MISSING_OPTION_'+k);
  return {command,opts};
}

function input(opts){
  const recipe=validateRecipe(JSON.parse(readFileSync(resolve(opts.recipe),'utf8')));
  const original=new Uint8Array(readFileSync(resolve(opts.input)));
  return {recipe,...readRegions(recipe,original)};
}
const regionList=recipe=>recipe.binary.regions.map(({id,bytes,sha256})=>({id,bytes,sha256}));
const project=async path=>import(pathToFileURL(resolve(path)).href);

export async function build({recipe,regions,revision},prepare,out){
  if(existsSync(out))fail('OUTPUT_EXISTS');
  const p=await prepare({recipe,regions});
  if(p.architecture!=='mc6809')fail('ARCHITECTURE_UNSUPPORTED_'+p.architecture);
  const {view,strategies}=p;
  const found=discoverStatic(view,strategies);
  const libUrl=pathToFileURL(ALU).href;
  const runtime=await discoverAtRuntime({view,seeds:found.seeds,
    compile:seeds=>compileProgram(view,seeds,{libUrl,entries:true}),
    scenarios:p.scenarios??[]});
  const seeds=[...found.seeds,...runtime.found];
  const program=compileProgram(view,seeds,{libUrl:'./alu.mjs',entries:true});
  const tools=Object.fromEntries(TOOLS.map(t=>[t,sha256(readFileSync(join(BASE,t)))]));
  const provenance={recipe:recipe.id,revision,regions:regionList(recipe),tools,
    strategies:{...strategies,boot:strategies.boot?view.identity(strategies.boot):null},
    scenarios:runtime.runs.map(r=>r.name),seeds:seeds.length};
  const manifest=writeBundle(join(out,'bundle'),{
    program:{file:'program.mjs',source:program.source,architecture:'mc6809',
      blocks:program.blockCount,functions:program.functions},
    libraries:{'alu.mjs':readFileSync(ALU,'utf8')},
    data:p.data(),meta:p.meta?.()??{},provenance});
  const report={schema:'rom-migration.build-report.v1',recipe:recipe.id,revision,
    program_sha256:manifest.files['program.mjs'],blocks:program.blockCount,
    functions:program.functions,
    static:{seeds:found.seeds.length,roots:found.roots,tables:found.tables,
      tableSeeds:found.tableSeeds,immediates:found.immediates},
    // Coverage limits: indirect exits are not resolved statically; the
    // run-time seeds are targets every static strategy missed.
    limits:{indirectExits:found.indirectExits,runtimeSeeds:runtime.found.length},
    runtime:runtime.runs,seeds:seeds.map(x=>view.identity(x))};
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',
    {flag:'wx',mode:0o600});
  return report;
}

export function checkBundle(dir,recipe){
  const bundle=readBundle(dir);
  const p=bundle.manifest.provenance;
  if(p.recipe!==recipe.id||p.revision!==recipe.binary.revision||
     JSON.stringify(p.regions)!==JSON.stringify(regionList(recipe)))
    fail('BUNDLE_RECIPE_MISMATCH');
  return bundle;
}

export async function main(argv){
  const {command,opts}=parseArgs(argv);
  const given=input(opts);
  if(command==='verify')return {command,recipe:given.recipe.id,
    revision:given.revision,regions:regionList(given.recipe)};
  if(command==='build'){
    const out=resolve(opts.out);
    mkdirSync(dirname(out),{recursive:true,mode:0o700});
    const report=await build(given,(await project(opts.project)).prepare,out);
    const {seeds,...summary}=report;
    return {command,out,...summary,seeds:seeds.length};
  }
  const bundle=checkBundle(resolve(opts.bundle),given.recipe);
  const hooks=opts.project?await project(opts.project):{};
  if(command==='validate')return {command,bundle:resolve(opts.bundle),
    program_sha256:bundle.manifest.files['program.mjs'],
    project:hooks.validate?await hooks.validate({...given,bundle,
      bundleDir:resolve(opts.bundle)}):null};
  if(!hooks.package)fail('PROJECT_PACKAGE_MISSING');
  return {command,...await hooks.package({...given,bundle,
    bundleDir:resolve(opts.bundle),out:resolve(opts.out)})};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r)))
    .catch(e=>{console.error('MIGRATE=BLOCKED_'+e.message.replace(/^MIGRATE_/,''));
      process.exitCode=2;});
}
