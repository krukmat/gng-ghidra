/**
 * R1/R4.2.B shared gngb frame compositor.
 *
 * CPU VRAM (FG/BG), buffered sprite RAM, graphics bitplanes, hardware
 * palette and scroll are explicit inputs. Does NOT emulate MC6809, perform
 * DMA, invent cold-boot RAM, or assert native pixel equivalence.
 *
 * Produces RGBA for a 256x224 visible raster (top 16 hardware lines
 * clipped), sharing the order/priorities with the R1 browser renderer.
 */
import {screenTile,bgPixelLayer,readTilePen} from './video_memory.mjs';
import {drawOrder,readSpritePen} from './sprite_memory.mjs';

export const GNG_FRAME_WIDTH=256;
export const GNG_FRAME_HEIGHT=224;
export const GNG_VISIBLE_Y_START=16;

export function renderGngbRgba({
  videoAddressSpace,bufferedSprites,chars,tiles,sprites,palette,scroll,
  flipScreen=false
}){
  if(!(videoAddressSpace instanceof Uint8Array)||
     videoAddressSpace.length!==65536||
     !(bufferedSprites instanceof Uint8Array)||bufferedSprites.length!==0x200||
     !(chars instanceof Uint8Array)||chars.length!==0x4000||
     !(tiles instanceof Uint8Array)||tiles.length!==0x18000||
     !(sprites instanceof Uint8Array)||sprites.length!==0x20000||
     !(palette instanceof Uint8Array)||palette.length!==0x400||
     !scroll||!Number.isInteger(scroll.x)||!Number.isInteger(scroll.y)||
     scroll.x<0||scroll.x>65535||scroll.y<0||scroll.y>65535||
     typeof flipScreen!=='boolean')
    throw Error('R42_INVALID_RENDERER_INPUTS');
  const W=GNG_FRAME_WIDTH,H=GNG_FRAME_HEIGHT;
  const rgba=new Uint8ClampedArray(W*H*4);
  const paint=(x,y,index)=>{
    if(x<0||y<0||x>=W||y>=H)return;
    const p=(y*W+x)*4,c=index*4;
    rgba[p]=palette[c];rgba[p+1]=palette[c+1];
    rgba[p+2]=palette[c+2];rgba[p+3]=255;
  };
  // MAME gng screen: BG back, sprites DMA buffer, BG front, FG.
  // First pass: group1 split-priority leaves pens 0 and 6 on back.
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const t=screenTile(videoAddressSpace,'bg',x,y+GNG_VISIBLE_Y_START,scroll.x,scroll.y);
    const pen=readTilePen('bg',tiles,t.graphic,t.x,t.y);
    if(bgPixelLayer(t.group,pen,'back'))paint(x,y,t.palette*8+pen);
  }
  for(const sprite of drawOrder(bufferedSprites)){
    for(let sy=0;sy<16;sy++)for(let sx=0;sx<16;sx++){
      const pen=readSpritePen(sprites,sprite.graphic,
        sprite.flipX?15-sx:sx,sprite.flipY?15-sy:sy);
      if(pen===15)continue;
      paint(sprite.x+sx,sprite.y+sy-GNG_VISIBLE_Y_START,
        0x40+sprite.paletteGroup*16+pen);
    }
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const t=screenTile(videoAddressSpace,'bg',x,y+GNG_VISIBLE_Y_START,scroll.x,scroll.y);
    if(t.group===0)continue;
    const pen=readTilePen('bg',tiles,t.graphic,t.x,t.y);
    if(bgPixelLayer(t.group,pen,'front'))paint(x,y,t.palette*8+pen);
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const t=screenTile(videoAddressSpace,'fg',x,y+GNG_VISIBLE_Y_START);
    const pen=readTilePen('fg',chars,t.graphic,t.x,t.y);
    if(pen!==3)paint(x,y,0x80+t.palette*4+pen);
  }
  // LS259 q0 (inverted) flips tilemaps and sprites together: the visible
  // raster turns 180 degrees. Pixel-checked against MAME only at scroll 0.
  if(flipScreen){
    const u32=new Uint32Array(rgba.buffer);
    u32.reverse();
  }
  return {width:W,height:H,rgba,
    native_pixel_equivalence_verified:false,
    autonomous_cpu_frame_rendered:false};
}
