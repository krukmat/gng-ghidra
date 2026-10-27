/** H3 lab directed maneuvers (never shipped): P1 input segments with the
 * cadence of h3_boss_search.mjs segment() plus 'idle', and the outcome of a
 * replayed variant. A row is fatal when the player object is in mode 3
 * (0x0503, set by the collision routine at 0xF586) without armour, when the
 * search's death handlers appear, or when a life is lost. Advance needs
 * `hold` consecutive non-fatal rows with X above `limit`.
 */
import {CYCLES_PER_FRAME} from './gngb_runtime.mjs';

export const MANEUVER_ACTIONS=['idle','right','right_fire','right_jump','right_fire_jump',
  'right_late_jump','fire','jump','duck_fire','left','left_fire','left_jump','up','up_fire','down'];
const event=(frame,control,pressed)=>({cycle:frame*CYCLES_PER_FRAME,control,pressed});

/** Events of one K-frame segment starting at `start`; 'idle' adds none. */
export function segmentEvents(start,action,K){
  if(!MANEUVER_ACTIONS.includes(action))throw Error('H3_MANEUVER_ACTION '+action);
  const e=[],hold=(c,a,b)=>e.push(event(a,c,true),event(b,c,false));
  const dir=action.startsWith('right')?'p1.right':action.startsWith('left')?'p1.left':
    action.startsWith('up')?'p1.up':action.startsWith('down')||action==='duck_fire'?'p1.down':null;
  if(dir)hold(dir,start,start+K-1);
  if(action.includes('fire'))for(let f=start+1;f+4<start+K;f+=12)hold('p1.button1',f,f+3);
  if(action.includes('jump')){
    const first=action==='right_late_jump'?start+Math.floor(K/2):start+1;
    for(let f=first;f+5<start+K;f+=44)hold('p1.button2',f,f+5);
  }
  return e.sort((a,b)=>a.cycle-b.cycle||a.control.localeCompare(b.control));
}
export const routeEvents=(start,route,K)=>route.flatMap((a,i)=>segmentEvents(start+i*K,a,K));

export const maneuverRow=(frame,b)=>({frame,phase:b[0x72],lives:b[0x60],armor:b[0xac],
  x:b[0xa0]<<8|b[0xa1],y:b[0xa2]<<8|b[0xa3],mode:b[0x503],sub:b[0x504],
  handler:b[0x510]<<8|b[0x511]});

export function maneuverOutcome(rows,{lives,limit=5464,hold=60}){
  const h=r=>r.handler;
  const fatal=r=>r.mode===3&&r.armor||h(r)<0x6000||r.armor&&(h(r)===0x8e05||h(r)===0x9c64||
    (h(r)&0xffe0)===0x9c40)||r.lives<lives;
  let run=0,above=0;
  for(const r of rows){run=r.x>limit&&!fatal(r)?run+1:0;above=Math.max(above,run);}
  const hit=rows.find(r=>r.mode===3),first=rows.find(fatal);
  return {hit:hit?.frame??null,fatal:first?.frame??null,maxX:Math.max(...rows.map(r=>r.x)),
    aboveLimit:above,local:!first,advance:above>=hold};
}
