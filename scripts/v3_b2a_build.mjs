#!/usr/bin/env node
/** V3.B2A private AOT build: reuse authenticated V2 code image, not MAME/ZIP.
 * Output is a SEPARATE immutable package under ignored out/v3/.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen,freezeBundle,MODULES} from '../src/v2_b1_frozen.mjs';
import {compileProgram} from '../src/mc6809_aot.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const old=join(ROOT,'out/v2/b1/frozen');
const output=join(ROOT,'out/v3/b2a/frozen');
const fail=reason=>{throw Error('V3_B2A_'+reason);};
function main(){
  if(process.argv.slice(2).join(' ')!=='--build')fail('ARGS_INVALID');
  if(existsSync(output))fail('BUNDLE_ALREADY_EXISTS');
  const {manifest,code}=loadFrozen(old);
  if(manifest.frames!==600||manifest.blocks<1)fail('V2_SOURCE_INVALID');
  const data=JSON.parse(readFileSync(join(ROOT,'out/r35/t5/seeds.json'),'utf8'));
  if(!Array.isArray(data)||data.length<1||data.length>3000)fail('SEEDS_INVALID');
  for(const o of data)if(o===null||typeof o!=='object'||
    !Number.isInteger(o.pc)||o.pc<0||o.pc>0xffff||
    !(o.bank===null||Number.isInteger(o.bank)&&o.bank>=0&&o.bank<=4)||
    !(o.overlay===undefined||o.overlay===null||
      Number.isInteger(o.overlay)&&o.overlay>=0&&o.overlay<code.ramOverlays.length))
    fail('SEED_MALFORMED');
  const vec=addr=>code.fixed[addr]<<8|code.fixed[addr+1];
  const base=[{bank:null,pc:vec(0xfffe)},{bank:null,pc:vec(0xfff8)}];
  const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;
  const generated=compileProgram(code,[...base,...data],{libUrl});
  if(generated.blockCount!==manifest.blocks)fail('BLOCK_COUNT_DRIFT');
  const modules=Object.fromEntries(MODULES.map(n=>[n,
    readFileSync(join(ROOT,'src',n),'utf8')]));
  const sourceHead=execFileSync('git',['rev-parse','HEAD'],
    {cwd:ROOT,encoding:'utf8'}).trim();
  mkdirSync(join(ROOT,'out/v3/b2a'),{recursive:true,mode:0o700});
  freezeBundle(output,{generated:generated.source,code,
    overlays:code.ramOverlays,modules,
    provenance:{frames:600,blocks:generated.blockCount,
      source_report_sha256:manifest.source_report_sha256,
      source_git_head:sourceHead}});
  console.log('V3_B2A_BUILD=PASS_PRIVATE_AOT_NO_ORACLE');
  console.log('V3_B2A_BLOCKS='+generated.blockCount);
}
try{main()}catch(e){
  console.error('V3_B2A_BUILD=BLOCKED_'+(String(e.message).startsWith('V3_B2A_')?
    String(e.message).slice(7):'PRIVATE_INPUT_OR_IO'));
  process.exitCode=2;
}
