/** Measures the actual compositor RGBA output. Never paints, synthesizes
 * colours or changes the framebuffer; a black image is honestly reported.
 */
export const FRAME_WIDTH=256,FRAME_HEIGHT=224,FRAME_BYTES=FRAME_WIDTH*FRAME_HEIGHT*4;
export function inspectRealFrame(bytes){
  if(!(bytes instanceof Uint8Array)&&
     !(bytes instanceof Uint8ClampedArray))
    throw Error('V3_B2C_INVALID_FRAME_TYPE');
  if(bytes.length!==FRAME_BYTES)throw Error('V3_B2C_INVALID_FRAME_LENGTH');
  let nonBlackPixels=0,transparentPixels=0,nonOpaquePixels=0;
  let minChannel=255,maxChannel=0;
  const colors=new Set();
  for(let i=0;i<bytes.length;i+=4){
    const r=bytes[i],g=bytes[i+1],b=bytes[i+2],a=bytes[i+3];
    if(r||g||b)nonBlackPixels++;
    if(a===0)transparentPixels++;
    if(a!==255)nonOpaquePixels++;
    minChannel=Math.min(minChannel,r,g,b);
    maxChannel=Math.max(maxChannel,r,g,b);
    colors.add((r<<16)|(g<<8)|b);
  }
  return Object.freeze({
    width:FRAME_WIDTH,height:FRAME_HEIGHT,bytes:FRAME_BYTES,
    nonBlackPixels,transparentPixels,nonOpaquePixels,
    rgbColors:colors.size,minChannel,maxChannel,
    allBlack:nonBlackPixels===0
  });
}
