/** GnG program bundle (rom-migration.bundle.v1, written by the base build):
 * `code.bin` is the fixed region and the five banks, `overlays.bin` the RAM
 * overlays described by `meta.overlays`. Free of Node APIs: the browser
 * worker and the Node tools rebuild the same code object from the bytes.
 */
export const GNG_BUNDLE_LAYOUT='gng.code-image.v1';
const CODE_BYTES=0x10000+5*0x2000;
const fail=code=>{throw Error('GNG_BUNDLE_'+code);};

export function gngCode(manifest,bytes,blob){
  if(manifest?.schema!=='rom-migration.bundle.v1'||
     manifest.program?.architecture!=='mc6809'||
     manifest.meta?.layout!==GNG_BUNDLE_LAYOUT)fail('MANIFEST');
  if(!(bytes instanceof Uint8Array)||bytes.length!==CODE_BYTES)fail('CODE_IMAGE_LENGTH');
  if(!(blob instanceof Uint8Array))fail('OVERLAYS');
  const ramOverlays=[];
  let cursor=0;
  for(const ov of manifest.meta.overlays??[]){
    if(!Number.isInteger(ov.start)||ov.start<0||ov.start>=0x3000||
       !Number.isInteger(ov.length)||ov.length<1||ov.start+ov.length>0x3000||
       ov.offset!==cursor||cursor+ov.length>blob.length)fail('OVERLAY_INVALID');
    ramOverlays.push({start:ov.start,bytes:blob.slice(cursor,cursor+ov.length)});
    cursor+=ov.length;
  }
  if(cursor!==blob.length)fail('OVERLAY_TRAILING_BYTES');
  return {fixed:bytes.slice(0,0x10000),banks:bytes.slice(0x10000),ramOverlays};
}
