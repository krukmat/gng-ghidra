/** Original binary → recipe regions. Build tool only (Node zlib).
 * A `zip` recipe names each region's member (`entry`, default `<id>.bin`);
 * a `flat` recipe gives each region's byte `offset` in one file. Every region
 * must match its declared length and SHA-256; nothing partial is accepted.
 */
import {createHash} from 'node:crypto';
import {inflateRawSync,crc32} from 'node:zlib';
import {validateRecipe} from '../contracts/index.mjs';

const fail=code=>{throw Error('MIGRATION_INPUT_'+code);};
const sha256=b=>createHash('sha256').update(b).digest('hex');

/** Members of a ZIP archive as {name: Uint8Array}; stored or deflated only. */
export function readZipEntries(bytes){
  if(!(bytes instanceof Uint8Array))fail('ZIP_BYTES');
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-22-0xffff);i--)
    if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}
  if(eocd<0)fail('ZIP_DIRECTORY');
  const count=dv.getUint16(eocd+10,true);
  let at=dv.getUint32(eocd+16,true);
  const out={};
  for(let n=0;n<count;n++){
    if(at+46>bytes.length||dv.getUint32(at,true)!==0x02014b50)fail('ZIP_DIRECTORY');
    const flags=dv.getUint16(at+8,true),method=dv.getUint16(at+10,true),
      crc=dv.getUint32(at+16,true),packed=dv.getUint32(at+20,true),
      size=dv.getUint32(at+24,true),nameLength=dv.getUint16(at+28,true),
      extra=dv.getUint16(at+30,true),comment=dv.getUint16(at+32,true),
      local=dv.getUint32(at+42,true);
    const name=new TextDecoder().decode(bytes.subarray(at+46,at+46+nameLength));
    at+=46+nameLength+extra+comment;
    if(name.endsWith('/'))continue;
    if(flags&1)fail('ZIP_ENCRYPTED '+name);
    if(Object.hasOwn(out,name))fail('ZIP_DUPLICATE '+name);
    if(local+30>bytes.length||dv.getUint32(local,true)!==0x04034b50)fail('ZIP_LOCAL '+name);
    const start=local+30+dv.getUint16(local+26,true)+dv.getUint16(local+28,true);
    if(start+packed>bytes.length)fail('ZIP_TRUNCATED '+name);
    const data=bytes.subarray(start,start+packed);
    let body;
    if(method===0)body=Uint8Array.from(data);
    else if(method===8)body=new Uint8Array(inflateRawSync(data));
    else fail('ZIP_METHOD '+name);
    if(body.length!==size||crc32(body)!==crc)fail('ZIP_CRC '+name);
    out[name]=body;
  }
  return out;
}

/** Recipe + original bytes → {revision, regions: {id: Uint8Array}}. */
export function readRegions(recipe,bytes){
  validateRecipe(recipe);
  if(!(bytes instanceof Uint8Array))fail('BYTES');
  const members=recipe.binary.kind==='zip'?readZipEntries(bytes):null;
  const regions={};
  for(const region of recipe.binary.regions){
    let data;
    if(members){
      data=members[region.entry??region.id+'.bin'];
      if(!data)fail('REGION_MISSING '+region.id);
    }else{
      if(!Number.isSafeInteger(region.offset))fail('REGION_OFFSET '+region.id);
      data=bytes.subarray(region.offset,region.offset+region.bytes);
    }
    if(data.length!==region.bytes||sha256(data)!==region.sha256)
      fail('REGION_MISMATCH '+region.id);
    regions[region.id]=Uint8Array.from(data);
  }
  return {revision:recipe.binary.revision,regions:Object.freeze(regions)};
}
