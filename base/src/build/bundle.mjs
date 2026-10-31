/** `rom-migration.bundle.v1`: one compiled program, the libraries it imports
 * and project data files, each with SHA-256 in `manifest.json`. Sizes, data
 * names and their layout (`meta`) belong to the project; the format fixes
 * none of them. Writing refuses an existing directory, dynamic code and
 * imports other than the declared libraries; reading refuses a missing,
 * extra, linked or corrupt file. Build tool only (Node fs).
 */
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync,existsSync}
  from 'node:fs';
import {join} from 'node:path';

export const BUNDLE_SCHEMA='rom-migration.bundle.v1';
const fail=code=>{throw Error('MIGRATION_BUNDLE_'+code);};
const sha256=b=>createHash('sha256').update(b).digest('hex');
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fileName=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9_.-]*$/i.test(x)&&
  x!=='manifest.json'&&!x.includes('..');

/** Import specifiers of a module source, dynamic forms rejected. */
function imports(source){
  if(/(?:\bimport\s*\(|\beval\s*\(|\bFunction\s*\()/.test(source))fail('DYNAMIC_CODE');
  return [...source.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/gm)]
    .map(m=>m[1]);
}

export function validateBundleManifest(m){
  if(!obj(m)||m.schema!==BUNDLE_SCHEMA||!obj(m.program)||
     !fileName(m.program.file)||typeof m.program.architecture!=='string'||
     !Number.isSafeInteger(m.program.blocks)||m.program.blocks<1||
     !Number.isSafeInteger(m.program.functions)||m.program.functions<1||
     !Array.isArray(m.libraries)||!m.libraries.every(fileName)||
     !obj(m.data)||!Object.keys(m.data).every(fileName)||
     !Object.values(m.data).every(d=>obj(d)&&Number.isSafeInteger(d.bytes)&&d.bytes>=0)||
     !obj(m.files)||!obj(m.provenance)||('meta' in m&&!obj(m.meta)))
    fail('MANIFEST_INVALID');
  const names=[m.program.file,...m.libraries,...Object.keys(m.data)];
  if(new Set(names).size!==names.length||
     Object.keys(m.files).sort().join('\n')!==[...names].sort().join('\n')||
     !Object.values(m.files).every(h=>typeof h==='string'&&/^[0-9a-f]{64}$/.test(h)))
    fail('MANIFEST_FILES');
  return m;
}

/** program: {file, source, architecture, blocks, functions};
 * libraries: {name: source}; data: {name: Uint8Array}. */
export function writeBundle(dir,{program,libraries={},data={},meta={},provenance={}}){
  if(existsSync(dir))fail('DESTINATION_EXISTS');
  if(!obj(program)||typeof program.source!=='string')fail('PROGRAM_MISSING');
  const libs=Object.keys(libraries);
  for(const spec of imports(program.source))
    if(!libs.some(name=>spec==='./'+name))fail('PROGRAM_IMPORT '+spec);
  for(const [name,source] of Object.entries(libraries))
    if(typeof source!=='string'||imports(source).length)fail('LIBRARY_IMPORTS '+name);
  const files={[program.file]:Buffer.from(program.source,'utf8')};
  for(const [name,source] of Object.entries(libraries))files[name]=Buffer.from(source,'utf8');
  for(const [name,bytes] of Object.entries(data)){
    if(!(bytes instanceof Uint8Array))fail('DATA_BYTES '+name);
    files[name]=Buffer.from(bytes);
  }
  const manifest=validateBundleManifest({schema:BUNDLE_SCHEMA,
    program:{file:program.file,architecture:program.architecture,
      blocks:program.blocks,functions:program.functions},
    libraries:libs,
    data:Object.fromEntries(Object.entries(data).map(([n,b])=>[n,{bytes:b.length}])),
    meta,provenance,
    files:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,sha256(b)]))});
  mkdirSync(dir,{recursive:true,mode:0o700});
  for(const [name,bytes] of Object.entries(files))
    writeFileSync(join(dir,name),bytes,{flag:'wx',mode:0o600});
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',
    {flag:'wx',mode:0o600});
  return manifest;
}

/** {manifest, files: {name: Uint8Array}} with every file checked. */
export function readBundle(dir){
  const regular=path=>{
    const st=lstatSync(path);
    if(!st.isFile()||st.isSymbolicLink())fail('NOT_REGULAR_FILE');
    return readFileSync(path);
  };
  const manifest=validateBundleManifest(JSON.parse(regular(join(dir,'manifest.json'))));
  const present=readdirSync(dir).filter(n=>n!=='manifest.json').sort();
  if(present.join('\n')!==Object.keys(manifest.files).sort().join('\n'))
    fail('FILE_SET');
  const files={};
  for(const [name,hash] of Object.entries(manifest.files)){
    const bytes=regular(join(dir,name));
    if(sha256(bytes)!==hash)fail('HASH_MISMATCH '+name);
    if(manifest.data[name]&&bytes.length!==manifest.data[name].bytes)
      fail('DATA_LENGTH '+name);
    files[name]=new Uint8Array(bytes);
  }
  return {manifest,files};
}
