#!/usr/bin/env node
/** Pin local reference inputs by explicit path. Report stays under ignored out/. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';

const [bundleArg,romArg,wasmArg,reportArg]=process.argv.slice(2);
if(!bundleArg||!romArg||!wasmArg||!reportArg)
  throw Error('RP0_USAGE: bundle rom-zip wasm report');
const bundle=resolve(bundleArg),rom=resolve(romArg),wasm=resolve(wasmArg),report=resolve(reportArg);
if(!report.startsWith(resolve('out')+'/'))throw Error('RP0_REPORT_MUST_BE_PRIVATE_OUT');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const item=path=>({path,bytes:statSync(path).size,sha256:hash(path)});
const version=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8'});
  return r.status===0?(r.stdout||r.stderr).split('\n')[0].trim():null;};
const {manifest}=loadFrozen(bundle); // verifies every bundle asset, not just the manifest
const audioBuild=JSON.parse(readFileSync('out/android/audio/build.json','utf8'));
if(hash(wasm)!==audioBuild.sha256)throw Error('RP0_WASM_BUILD_HASH_MISMATCH');
const files=['manifest.json',...Object.keys(manifest.files)];
const reference={schema:'rom-migration.rp0.reference.v1',createdAt:new Date().toISOString(),
  scope:'local-private-reference',gitHead:version('git',['rev-parse','HEAD']),
  sourceGitHead:manifest.source_git_head,
  tools:{node:process.version,python:version('python3',['--version']),
    mame:version('mame',['-version']),java:version('java',['-version']),
    gradle:readFileSync('android/gradle/wrapper/gradle-wrapper.properties','utf8')
      .match(/gradle-[\d.]+-bin\.zip/)?.[0]??null,
    emccInstalled:version('emcc',['--version']),emccForWasm:audioBuild.emcc,
    ymfm:audioBuild.ymfm},
  inputs:{romZip:item(rom),ym2203Wasm:item(wasm),bundle:{path:bundle,
    schema:manifest.schema,frames:manifest.frames,blocks:manifest.blocks,
    files:Object.fromEntries(files.map(name=>[name,item(join(bundle,name))]))}},
  note:'No ROM bytes, decoded code, traces, or credentials are recorded.'};
mkdirSync(dirname(report),{recursive:true,mode:0o700});
writeFileSync(report,JSON.stringify(reference,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({schema:reference.schema,gitHead:reference.gitHead,
  bundleFiles:files.length,report}));
