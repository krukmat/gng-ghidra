/** Lancelot's provisional look (plan docs/plan-lancelot-2026-11-20.md, phase 1).
 *
 * The player's sprites are identified by graphic, never by slot (the ROM
 * hands out slots dynamically): 0x000-0x02F armored body, 0x100-0x12F body
 * without armor, 0x130-0x133/0x138-0x13B the armor bursting off on a hit.
 * Over 21,419 gameplay frames of the bot tapes these graphics only appear
 * with sprite palette group 0 and no other object uses them, so an enemy at
 * the same place or with the same palette is never recolored. The armor
 * lying on the ground (0x134/0x13D) is a separate object and is left alone.
 *
 * The face is located by the eye: pen 0 appears once per facing pose. Pens
 * 4, 5 and 9 above the eye are hair (dark brown), below it beard, which
 * becomes skin (Lancelot is clean-shaven). Poses without an eye (from
 * behind) take their top rows as hair. In the armored poses the armor pens
 * become a light archer outfit: olive green tunic, brown leather, raw linen.
 * Provisional pen mapping only; phase 2 retouches pieces by hand.
 */
import {readSpritePen} from './sprite_memory.mjs';

export const PLAYER_PALETTE_GROUP=0;
const VISIBLE_Y=16;

export function playerPiece(graphic){
  if(graphic<0x030)return 'outfit';
  if(graphic>=0x100&&graphic<0x130)return 'body';
  if((graphic>=0x130&&graphic<0x134)||(graphic>=0x138&&graphic<0x13c))return 'burst';
  return null;
}
const rgb=(r,g,b)=>(r<<16)|(g<<8)|b;
// Armor pens 12/6/7 light-to-dark, 8 darkest, 10/11 red trim.
const OUTFIT=new Map([[12,rgb(150,158,78)],[6,rgb(112,120,52)],[7,rgb(78,86,36)],
  [8,rgb(92,58,30)],[10,rgb(222,206,160)],[11,rgb(184,164,120)]]);
const HAIR=new Map([[9,rgb(104,68,40)],[4,rgb(74,46,26)],[5,rgb(48,30,16)]]);
const SHAVEN=new Map([[4,rgb(170,136,102)],[5,rgb(140,106,76)],[9,rgb(170,136,102)]]);
const EYE=0;
// Face window around the eye, in pixels: hair above, beard below.
const FACE={left:7,right:7,up:6,down:6};

/** Override colors for one frame: Map(slot*256+sy*16+sx -> 0xRRGGBB) over
 * the unflipped pixel (sx,sy) of each player sprite. `sprites` is
 * drawOrder(buffer); `rom` the 0x20000-byte sprite region. */
export function playerSprites(sprites){
  // Free slots hold graphic 0 at y 0, above the visible raster (y >= 16).
  return sprites.filter(s=>s.paletteGroup===PLAYER_PALETTE_GROUP&&
    s.y+15>=VISIBLE_Y&&playerPiece(s.graphic)!==null);
}
export function lancelotOverrides(sprites,rom){
  const player=playerSprites(sprites);
  const overrides=new Map();
  if(!player.length)return overrides;
  const pixels=[];
  for(const s of player){
    const piece=playerPiece(s.graphic);
    for(let sy=0;sy<16;sy++)for(let sx=0;sx<16;sx++){
      const pen=readSpritePen(rom,s.graphic,s.flipX?15-sx:sx,s.flipY?15-sy:sy);
      if(pen===15)continue;
      pixels.push({key:s.slot*256+sy*16+sx,x:s.x+sx,y:s.y+sy,pen,piece});
    }
  }
  const eyes=pixels.filter(p=>p.pen===EYE&&p.piece!=='burst');
  const top=Math.min(...pixels.map(p=>p.y));
  for(const p of pixels){
    if(p.piece!=='body'&&OUTFIT.has(p.pen)){overrides.set(p.key,OUTFIT.get(p.pen));continue;}
    if(!HAIR.has(p.pen))continue;
    if(eyes.length){
      const eye=eyes.find(e=>p.x>=e.x-FACE.left&&p.x<=e.x+FACE.right&&
        p.y>=e.y-FACE.up&&p.y<=e.y+FACE.down);
      if(!eye)continue;
      overrides.set(p.key,(p.y<eye.y?HAIR:SHAVEN).get(p.pen));
    }else if(p.piece==='body'&&p.y<top+8)overrides.set(p.key,HAIR.get(p.pen));
  }
  return overrides;
}
