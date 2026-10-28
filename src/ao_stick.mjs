/** Floating thumbstick geometry: a drag from the touch point becomes one
 * sector, or none. The engine accepts a single direction, so each sector maps
 * to at most one direction; the upper diagonals add Jump (run and jump that
 * way) while straight up stays Up, for ladders. Pure: no DOM, timers or ports.
 */
export const STICK=Object.freeze({
  dead:0.3,       // fraction of the radius with no sector
  release:0.22,   // a held sector lasts down to this fraction
  hysteresis:8,   // degrees past its edges a held sector keeps
});
// Angles in degrees, 0 = right, 90 = up; ranges are [from, to). Operator
// (28/10): wide jump diagonals, so running into a jump takes ~20 px of thumb.
export const SECTORS=Object.freeze([
  {name:'right',from:-45,to:15,dir:'p1.right',jump:false},
  {name:'up-right',from:15,to:75,dir:'p1.right',jump:true},
  {name:'up',from:75,to:105,dir:'p1.up',jump:false},
  {name:'up-left',from:105,to:165,dir:'p1.left',jump:true},
  {name:'left',from:165,to:225,dir:'p1.left',jump:false},
  {name:'down',from:225,to:315,dir:'p1.down',jump:false},
].map(Object.freeze));
const BY_NAME=Object.freeze(Object.fromEntries(SECTORS.map(s=>[s.name,s])));
const norm=a=>((a+45)%360+360)%360-45; // [-45, 315)
const within=(angle,from,to)=>{
  const span=to-from,offset=((angle-from)%360+360)%360;
  return offset<span;
};

// dx, dy in screen pixels (y grows downwards). current: a sector name.
export function stickSector(dx,dy,radius,current=null){
  const r=Math.hypot(dx,dy);
  if(r<radius*(current?STICK.release:STICK.dead))return null;
  const angle=norm(Math.atan2(-dy,dx)*180/Math.PI);
  const held=BY_NAME[current];
  if(held&&within(angle,held.from-STICK.hysteresis,held.to+STICK.hysteresis))
    return held;
  return SECTORS.find(s=>within(angle,s.from,s.to));
}
// Beyond the radius the base follows the finger, so a long drag never
// stalls and turning back answers at once.
export function followBase(base,point,radius){
  const dx=point.x-base.x,dy=point.y-base.y,r=Math.hypot(dx,dy);
  if(r<=radius)return base;
  const k=(r-radius)/r;
  return {x:base.x+dx*k,y:base.y+dy*k};
}
// Knob offset from the base centre, clamped to the radius.
export function knobOffset(base,point,radius){
  const dx=point.x-base.x,dy=point.y-base.y,r=Math.hypot(dx,dy);
  const k=r>radius?radius/r:1;
  return {x:dx*k,y:dy*k};
}
