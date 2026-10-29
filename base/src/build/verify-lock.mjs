import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {validateLock} from '../contracts/index.mjs';

/** Verify selected copied components without needing the source checkout. */
export function verifyPinnedComponents(baseDir,lock){
  validateLock(lock);
  for(const [name,expected] of Object.entries(lock.base.components)){
    const parts=name.split('/');
    let path=baseDir;
    for(let i=0;i<parts.length;i++){
      path=join(path,parts[i]);
      let stat;
      try{stat=lstatSync(path);}catch{
        throw Error('MIGRATION_COMPONENT_MISSING '+name);
      }
      if(stat.isSymbolicLink()||(i<parts.length-1&&!stat.isDirectory())||
         (i===parts.length-1&&!stat.isFile()))
        throw Error('MIGRATION_COMPONENT_NOT_FILE '+name);
    }
    const bytes=readFileSync(path);
    const actual=createHash('sha256').update(bytes).digest('hex');
    if(actual!==expected)throw Error('MIGRATION_COMPONENT_HASH_MISMATCH '+name);
  }
  return true;
}
