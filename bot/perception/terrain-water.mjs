/** Candidate gngb water terrain from real 256x224 RGBA. Palette/scan rows
 * are provisional stage-1 calibration. Never infers grounded, victory or kill.
 */
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const islandGreen=(r,g,b)=>(r===0&&g>=80&&g<=200&&b===0)||
  (r>=95&&g>=170&&b>=80&&g>r*1.25);
const bankGrass=(r,g,b)=>(r===85&&g===119&&b===0)||
  (r===136&&g===170&&b===0)||(r===170&&g===204&&b===119)||
  (r===0&&g===68&&b===0);
const runs=(indices,maxGap=4)=>{
  if(!indices.length)return [];
  const out=[];let left=indices[0],right=left;
  for(const x of indices.slice(1)){
    if(x-right>maxGap){out.push([left,right]);left=x;}
    right=x;
  }
  out.push([left,right]);return out;
};
export function detectWaterTerrain({rgba,width=256,height=224,
  grassTop=196,scanBottom=200,bankTop=192,bankBottom=206,
  minIslandSeparationPx=12}={}){
  if(!(rgba instanceof Uint8Array||rgba instanceof Uint8ClampedArray)||
     !integer(width,32)||!integer(height,64)||rgba.length!==width*height*4||
     !integer(grassTop)||!integer(scanBottom)||!integer(bankTop)||
     !integer(bankBottom)||grassTop>scanBottom||
     bankTop>bankBottom||bankBottom>=height||
     !Number.isSafeInteger(minIslandSeparationPx)||minIslandSeparationPx<0)
    throw Error('BOT_TERRAIN_INPUT');
  const greens=Array(width).fill(0),banks=Array(width).fill(0);
  for(let x=0;x<width;x++){
    for(let y=grassTop;y<=scanBottom;y++){
      const i=(y*width+x)*4;
      if(islandGreen(rgba[i],rgba[i+1],rgba[i+2]))greens[x]++;
    }
    for(let y=bankTop;y<=bankBottom;y++){
      const i=(y*width+x)*4;
      if(bankGrass(rgba[i],rgba[i+1],rgba[i+2]))banks[x]++;
    }
  }
  const hasLeft=banks.slice(0,24).filter(n=>n>0).length>=12;
  let shore=null;
  if(hasLeft){
    for(let x=20;x<width-12;x++){
      if(banks.slice(x,x+12).filter(n=>n>1).length<2){
        shore=x;break;
      }
    }
  }
  // Keep small visible fragments for a temporal observer to reason about
  // occlusion. They are not standalone island detections.
  const islandFragments=runs(greens.map((n,x)=>n>=2?x:null)
    .filter(x=>x!==null)).filter(([a,b])=>b-a>=2&&b-a<=64)
    .map(([left,right])=>({left,right,topY:grassTop,
      pixelEvidence:greens.slice(left,right+1).reduce((a,b)=>a+b,0)}));
  const islands=islandFragments.filter(v=>v.right-v.left>=14);
  // A tracked platform can approach the bank closely enough to board.
  // The diagnostic default retains separation; calibrated observers may
  // lower it without confusing a disappearing water gap with a lost sprite.
  const island=shore===null?null:
    islands.find(v=>v.left>shore+minIslandSeparationPx)??null;
  // Land runs share the bank palette. The far bank must stay detectable after
  // the departure bank scrolls out, so it no longer needs leftBank or island;
  // it must start clear of the screen edge, the shore and any island.
  const landSegments=runs(banks.map((n,x)=>n>1?x:null).filter(x=>x!==null))
    .filter(([left,right])=>right-left+1>=24)
    .map(([left,right])=>({left,right,topY:bankTop}));
  const far=landSegments.find(s=>s.left>=12&&(shore===null||s.left>shore+12)&&
    (!island||s.left>island.right+12));
  const rightBank=far?{...far,verified:false}:null;
  return {kind:'TERRAIN_CANDIDATE',
    leftBank:shore===null?null:{right:shore},island,islandFragments,rightBank,
    landSegments,
    hasWaterGap:!!(island&&shore!==null),verified:false};
}
export function createIslandVelocityTracker({maxGapFrames=20,
  maxSpeedPxPerFrame=4,minDisplacementPx=0.5}={}){
  if(!integer(maxGapFrames,1)||!Number.isFinite(maxSpeedPxPerFrame)||
     maxSpeedPxPerFrame<=0||!Number.isFinite(minDisplacementPx)||
     minDisplacementPx<0)throw Error('BOT_ISLAND_TRACKER_OPTIONS');
  let last=null,velocity=null,confirmed=0;
  const reset=()=>{last=null;velocity=null;confirmed=0;};
  const unknown=reason=>({status:'UNKNOWN',reason,velocity:null,samples:confirmed});
  function observe({frame,session,terrain}={}){
    if(!integer(frame)||typeof session!=='string'||!session)
      throw Error('BOT_ISLAND_TRACKER_FRAME');
    const shore=terrain?.leftBank?.right,island=terrain?.island;
    if(!integer(shore)||!integer(island?.left)||!integer(island?.right)){
      reset();return unknown('TERRAIN_UNOBSERVED');
    }
    const relative=(island.left+island.right)/2-shore;
    if(!last){last={frame,session,relative};return unknown('FIRST_SAMPLE');}
    const dt=frame-last.frame;
    if(session!==last.session||dt<=0||dt>maxGapFrames){
      reset();return unknown('SESSION_OR_FRAME_GAP');
    }
    const displacement=relative-last.relative;
    const nextVelocity=displacement/dt;
    last={frame,session,relative};
    if(Math.abs(nextVelocity)>maxSpeedPxPerFrame){
      reset();return unknown('UNRELIABLE_VELOCITY');
    }
    if(Math.abs(displacement)<minDisplacementPx){
      velocity=null;confirmed=0;return unknown('NO_MEASURABLE_MOTION');
    }
    if(velocity!==null&&Math.sign(velocity)!==Math.sign(nextVelocity)){
      velocity=nextVelocity;confirmed=1;return unknown('DIRECTION_CHANGED');
    }
    velocity=nextVelocity;confirmed++;
    if(confirmed<2)return unknown('AWAITING_SECOND_VELOCITY');
    return {status:'MOTION_CANDIDATE',velocity,samples:confirmed,
      coordinateSystem:'ISLAND_MINUS_LEFT_BANK',calibrated:false};
  }
  return {observe,reset};
}
