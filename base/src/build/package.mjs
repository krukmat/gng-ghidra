/** Web packaging helpers (build tool only): the static-import closure of the
 * selected browser modules and a SHA-256 index of a packaged directory.
 * What the product ships (data, devices, pages) is chosen by the project.
 */
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';

const fail=code=>{throw Error('MIGRATION_PACKAGE_'+code);};

/** Root-relative paths reached from `entries` by relative `.mjs` imports;
 * every path must start with one of `allow`. `data:` imports are skipped. */
export function moduleClosure(root,entries,{allow}){
  if(!Array.isArray(allow)||!allow.length)fail('ALLOW_REQUIRED');
  const seen=new Set(),queue=[...entries];
  while(queue.length){
    const name=queue.shift(),absolute=resolve(root,name);
    if(seen.has(name))continue;
    if(!absolute.startsWith(resolve(root)+sep)||!allow.some(p=>name.startsWith(p)))
      fail('MODULE_OUTSIDE_SELECTION '+name);
    seen.add(name);
    const text=readFileSync(absolute,'utf8');
    for(const m of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g)){
      const spec=m[1]??m[2];
      if(spec.startsWith('data:'))continue;
      if(!/^\.\.?(?:\/[\w.-]+)+\.mjs$/.test(spec))
        fail('NON_BROWSER_IMPORT '+name+' '+spec);
      queue.push(relative(root,resolve(dirname(absolute),spec)));
    }
  }
  return [...seen].sort();
}

/** {relativePath: sha256} for every file under `dir`, sorted. */
export function fileIndex(dir){
  const list=d=>readdirSync(d).flatMap(n=>{
    const p=join(d,n);
    return statSync(p).isDirectory()?list(p):[p];
  });
  return Object.fromEntries(list(dir).sort().map(p=>[relative(dir,p),
    createHash('sha256').update(readFileSync(p)).digest('hex')]));
}
