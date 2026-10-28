/** Android WebView asset formats, free of Node APIs.
 * gfx.bin packs the gngb graphics regions; frozenCode() rebuilds the same
 * code object as loadFrozen() from manifest.json, code.bin and overlays.bin
 * (the hashes are checked by loadFrozen when the assets are built).
 */
export const GFX_LAYOUT=Object.freeze([['chars',0x4000],['tiles',0x18000],
  ['sprites',0x20000]]);
const GFX_BYTES=GFX_LAYOUT.reduce((n,[,size])=>n+size,0);

export function packGfx(gfx){
  const out=new Uint8Array(GFX_BYTES);
  let at=0;
  for(const [name,size] of GFX_LAYOUT){
    if(!(gfx?.[name] instanceof Uint8Array)||gfx[name].length!==size)
      throw Error('AO_GFX_REGION_INVALID');
    out.set(gfx[name],at);at+=size;
  }
  return out;
}
export function unpackGfx(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==GFX_BYTES)
    throw Error('AO_GFX_LENGTH');
  const gfx={};
  let at=0;
  for(const [name,size] of GFX_LAYOUT){gfx[name]=bytes.slice(at,at+size);at+=size;}
  return gfx;
}
export function frozenCode(manifest,bytes,blob){
  if(!(bytes instanceof Uint8Array)||bytes.length!==0x1a000)
    throw Error('AO_CODE_IMAGE_LENGTH');
  const ramOverlays=[];
  let cursor=0;
  for(const ov of manifest?.overlays??[]){
    if(!Number.isInteger(ov.start)||ov.start<0||ov.start>=0x3000||
       !Number.isInteger(ov.length)||ov.length<1||ov.start+ov.length>0x3000||
       ov.offset!==cursor||cursor+ov.length>blob.length)
      throw Error('AO_OVERLAY_MANIFEST_INVALID');
    ramOverlays.push({start:ov.start,bytes:blob.slice(cursor,cursor+ov.length)});
    cursor+=ov.length;
  }
  if(cursor!==blob.length)throw Error('AO_OVERLAY_TRAILING_BYTES');
  return {fixed:bytes.slice(0,0x10000),banks:bytes.slice(0x10000),ramOverlays};
}
