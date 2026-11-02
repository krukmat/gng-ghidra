/** H3 lab: follow a donor route (inputs only, never shipped). The donor
 * trail is Arthur's position per donor frame (x<0 where the donor is not in
 * the searched phase). A branch is matched to the nearest trail point around
 * its parent's match, so delays, detours and shortcuts keep their place on
 * the route; 'follow' replays the donor's P1 masks from that point.
 */
import {CYCLES_PER_FRAME} from './gngb_runtime.mjs';
import {P1_BITS} from './h3_explore.mjs';

/** Frames a match may move back or ahead per segment of K frames. */
export const trailWindow=K=>({behind:2*K+60,ahead:3*K+30});

/** Nearest valid point of `trail` ({lo,hi,pos}) to s.x,s.y in
 * [k-behind,k+ahead]; ties go to the later donor frame (waits are skipped). */
export function matchTrail(trail,s,k,{behind,ahead}){
  let best=k,d=Infinity;
  for(let j=Math.max(trail.lo,k-behind);j<=Math.min(trail.hi,k+ahead);j++){
    const i=2*(j-trail.lo),x=trail.pos[i];
    if(x<0)continue;
    const dj=Math.abs(s.x-x)+Math.abs(s.y-trail.pos[i+1]);
    if(dj<=d){d=dj;best=j;}
  }
  return {k:best,d};
}

/** Port events that replay donor masks[k..k+n) (masks[0] = donor frame lo)
 * from frame `start`, continuing from the P1 mask `held`. */
export function followEvents(masks,lo,k,start,n,held){
  const events=[];let prev=held;
  for(let f=start;f<start+n;f++){
    const m=masks[k-lo+f-start];
    if(m===undefined)throw Error('H3_FOLLOW_MASK_RANGE '+(k+f-start));
    for(const [control,bit] of Object.entries(P1_BITS))
      if((prev^m)&bit)events.push({cycle:f*CYCLES_PER_FRAME,control,pressed:!!(m&bit)});
    prev=m;
  }
  return {events,mask:prev};
}

/** A macro's events after a 'follow' segment: P1 controls still held are
 * released at `start`, unless the macro presses them then (kept held). */
export function joinEvents(start,held,events){
  const at=start*CYCLES_PER_FRAME;
  const now=new Set(events.filter(e=>e.cycle===at&&e.pressed).map(e=>e.control));
  const kept=Object.entries(P1_BITS).filter(([,bit])=>held&bit).map(([c])=>c);
  return [...kept.filter(c=>!now.has(c)).map(control=>({cycle:at,control,pressed:false})),
    ...events.filter(e=>!(e.cycle===at&&e.pressed&&kept.includes(e.control)))]
    .sort((a,b)=>a.cycle-b.cycle||(a.control<b.control?-1:a.control>b.control?1:0));
}

/** P1 mask still held after `events`. */
export const heldMask=events=>events.reduce((m,e)=>!Object.hasOwn(P1_BITS,e.control)?m:
  e.pressed?m|P1_BITS[e.control]:m&~P1_BITS[e.control],0);
