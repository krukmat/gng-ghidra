#!/usr/bin/env node
/** Desktop route: the common app (out/android/assets, built by
 * ao_build_assets.mjs) served on loopback only, with keyboard controls.
 * The browser checks reuse createAssetServer on a free port.
 * Usage: node scripts/ao_serve.mjs [port]   # default 18609
 */
import {createServer} from 'node:http';
import {readFileSync,statSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
export const ASSETS=join(ROOT,'out/android/assets');
const MIME={'.html':'text/html','.mjs':'text/javascript','.json':'application/json',
  '.bin':'application/octet-stream','.wasm':'application/wasm'};

export function createAssetServer(dir=ASSETS){
  return createServer((req,res)=>{
    try{
      const path=resolve(dir,'.'+new URL(req.url,'http://local').pathname);
      if(!path.startsWith(dir+sep)||!MIME[extname(path)]||!statSync(path).isFile())
        throw Error('NOT_FOUND');
      res.writeHead(200,{'Content-Type':MIME[extname(path)],'Cache-Control':'no-store'});
      res.end(readFileSync(path));
    }catch{res.writeHead(404);res.end();}
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const port=Number(process.argv[2]??18609);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('AO_SERVE_PORT_INVALID');
  try{statSync(join(ASSETS,'index.html'));}
  catch{throw Error('AO_SERVE_ASSETS_MISSING: run node scripts/ao_build_assets.mjs');}
  const server=createAssetServer();
  server.listen(port,'127.0.0.1',()=>console.log('AO_SERVE http://127.0.0.1:'+
    server.address().port+'/index.html'));
}
