/** Candidate Arthur BODY colors in the supplied stage-1 unarmored palette.
 * NOT a grounded, death, or combat-victory classifier.
 */
const skin=(r,g,b)=>(r===170&&g===136&&b===102)||
  (r===204&&g===170&&b===136);
export function detectArthurSkin({rgba,width=256,height=224,
  top=96,bottom=191,minPixels=24,roiLeft=0,roiRight=255}={}){
  if(!(rgba instanceof Uint8Array||rgba instanceof Uint8ClampedArray)||
    rgba.length!==width*height*4||top<0||bottom>=height||top>=bottom||
    roiLeft<0||roiRight>=width||roiLeft>=roiRight)
    throw Error('BOT_ARTHUR_SKIN_INPUT');
  const columns=Array(width).fill(0),positions=[];
  for(let y=top;y<=bottom;y++)for(let x=roiLeft;x<=roiRight;x++){
    const i=(y*width+x)*4;
    if(skin(rgba[i],rgba[i+1],rgba[i+2])){
      columns[x]++;positions.push([x,y]);
    }
  }
  const hits=columns.map((n,i)=>n>=2?i:null).filter(x=>x!==null);
  const candidates=[];
  if(hits.length){
    let lo=hits[0],hi=lo;
    const push=()=>{
      const pts=positions.filter(([x])=>x>=lo&&x<=hi);
      if(pts.length>=minPixels&&hi-lo>=7&&hi-lo<=39)
        candidates.push({left:lo,right:hi,
          top:Math.min(...pts.map(p=>p[1])),
          bottom:Math.max(...pts.map(p=>p[1])),
          pixels:pts.length});
    };
    for(const x of hits.slice(1)){
      if(x-hi>4){push();lo=x;}hi=x;
    }
    push();
  }
  candidates.sort((a,b)=>b.pixels-a.pixels);
  if(!candidates.length)return {kind:'UNKNOWN',
    reason:'BODY_PALETTE_ABSENT_OR_NO_SPRITE_SHAPE',candidates:[]};
  if(candidates.length>1&&candidates[1].pixels>=candidates[0].pixels*.6)
    return {kind:'UNKNOWN',reason:'AMBIGUOUS_BODY_PALETTE',candidates};
  return {kind:'ARTHUR_SKIN_CANDIDATE',...candidates[0],
    x:(candidates[0].left+candidates[0].right)/2,
    grounded:null,verified:false,candidates:candidates.length};
}
