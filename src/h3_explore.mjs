/** H3-S1 lab explorer (never shipped): Go-Explore over P1 inputs only.
 * A trajectory is one P1 mask per frame from `start` (bit set = pressed);
 * it becomes port events exactly where the mask changes, so a tape is
 * only inputs. Cells are (phase, checkpoint, X>>4, Y>>3, armour); a cell
 * keeps the trajectory that preserves the armour and, at equal armour,
 * reaches it in fewer frames. Everything is a pure function of the seed.
 */
import {createHash} from 'node:crypto';
import {CYCLES_PER_FRAME} from './gngb_runtime.mjs';
import {maneuverFatal} from './h3_lab_maneuver.mjs';

export const P1_BITS=Object.freeze({'p1.right':1,'p1.left':2,'p1.down':4,'p1.up':8,
  'p1.button1':16,'p1.button2':32});
const DIRS=[0,1,2,4,8],FIRE=16,JUMP=32;

/** mulberry32: small, seedable, identical on every platform. */
export function prng(seed){
  let s=seed>>>0;
  return ()=>{
    s=s+0x6d2b79f5>>>0;let t=s;
    t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

export const EXPLORE_DEFAULTS=Object.freeze({chunk:120,evalEvery:4,
  // none,right,left,down,up: biased to the right, ladders still reachable.
  dirWeights:Object.freeze([0.12,0.55,0.15,0.08,0.10]),holdMin:4,holdMax:32,
  fireRate:0.08,fireMin:2,fireMax:5,jumpRate:0.05,jumpMin:2,jumpMax:8,scrollBonus:1});

/** `n` sticky masks after `prev`: a direction is held several frames; fire
 * and jump are presses of a few frames, always followed by a released
 * frame (also when `prev` ended pressed), so every press is a new press. */
export function chunkMasks(rand,n,prev=0,p=EXPLORE_DEFAULTS){
  const out=new Uint8Array(n),span=(a,b)=>a+Math.floor(rand()*(b-a+1));
  const buttons=[[FIRE,p.fireRate,p.fireMin,p.fireMax],[JUMP,p.jumpRate,p.jumpMin,p.jumpMax]]
    .map(([bit,rate,min,max])=>({bit,rate,min,max,left:0,was:!!(prev&bit)}));
  let dir=0,hold=0;
  for(let i=0;i<n;i++){
    if(hold===0){
      let r=rand(),k=0;
      while(k<DIRS.length-1&&r>=p.dirWeights[k]){r-=p.dirWeights[k];k++;}
      dir=DIRS[k];hold=span(p.holdMin,p.holdMax);
    }
    hold--;
    let m=dir;
    for(const b of buttons){
      if(b.left===0&&!b.was&&rand()<b.rate)b.left=span(b.min,b.max);
      b.was=b.left>0;
      if(b.was){m|=b.bit;b.left--;}
    }
    out[i]=m;
  }
  return out;
}

/** Port events of masks applied from frame `start`, all released at the end. */
export function masksToEvents(start,masks){
  const events=[];let prev=0;
  const emit=(frame,m)=>{
    for(const [control,bit] of Object.entries(P1_BITS))
      if((prev^m)&bit)events.push({cycle:frame*CYCLES_PER_FRAME,control,pressed:!!(m&bit)});
    prev=m;
  };
  masks.forEach((m,i)=>emit(start+i,m));
  emit(start+masks.length,0);
  return events.sort((a,b)=>a.cycle-b.cycle||(a.control<b.control?-1:a.control>b.control?1:0));
}

/** RAM labels (read only) of one 0x600-byte view. */
export const look=b=>({phase:b[0x72],cp:b[0x81],loop:b[0x71],lives:b[0x60],
  x:b[0xa0]<<8|b[0xa1],y:b[0xa2]<<8|b[0xa3],scroll:b[0x58]<<8|b[0x59],armor:b[0xac],
  mode:b[0x503],handler:b[0x510]<<8|b[0x511]});
export const isFatal=(s,lives)=>maneuverFatal(s,lives);
export const cellKey=s=>[s.phase,s.cp,s.x>>4,s.y>>3,s.armor].join(':');
/** True when `c` beats `old` for the same cell (armour first, then frames). */
export const better=(c,old)=>!old||c.armor<old.armor||c.armor===old.armor&&c.frame<old.frame;

/** Weighted pick: rarely chosen cells first, slight bonus for scroll. */
export function pickCell(cells,rand,scrollBonus=EXPLORE_DEFAULTS.scrollBonus){
  let total=0;const w=cells.map(c=>{
    const v=(1+scrollBonus*Math.min(c.scroll,3072)/3072)/Math.sqrt(1+c.chosen);
    total+=v;return v;});
  let r=rand()*total;
  for(let i=0;i<cells.length;i++){r-=w[i];if(r<0)return cells[i];}
  return cells.at(-1);
}

export const sha256=x=>createHash('sha256').update(x).digest('hex');
/** Canonical cell listing (no snapshots), stable for determinism checks. */
export const cellsListing=cells=>[...cells].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)
  .map(c=>({key:c.key,frame:c.frame,armor:c.armor,x:c.x,y:c.y,scroll:c.scroll,
    chosen:c.chosen,masks:sha256(c.masks)}));
