/** Small, ROM-free RGBA template locator for offline/private calibration.
 * Similarity is not a calibrated probability. A weak or ambiguous match is
 * UNKNOWN; callers must never invent Arthur/enemy coordinates from it.
 */
export function locateRgbaTemplate({rgba,width,height,template,
  templateWidth,templateHeight,roi=null,stride=1,minScore=0.95,
  minMargin=0.04}={}){
  const integer=n=>Number.isSafeInteger(n)&&n>0;
  const pixels=x=>x instanceof Uint8Array||x instanceof Uint8ClampedArray;
  if(!integer(width)||!integer(height)||!integer(templateWidth)||
     !integer(templateHeight)||!pixels(rgba)||!pixels(template)||
     rgba.length!==width*height*4||
     template.length!==templateWidth*templateHeight*4||
     !integer(stride)||typeof minScore!=='number'||minScore<0||
     minScore>1||!Number.isFinite(minScore)||
     typeof minMargin!=='number'||minMargin<0||minMargin>1||
     !Number.isFinite(minMargin))
    throw Error('BOT_TEMPLATE_INPUT');
  const region=roi??{x:0,y:0,width,height};
  if(!Number.isSafeInteger(region.x)||!Number.isSafeInteger(region.y)||
     !integer(region.width)||!integer(region.height)||
     region.x<0||region.y<0||
     region.x+region.width>width||region.y+region.height>height||
     templateWidth>region.width||templateHeight>region.height)
    throw Error('BOT_TEMPLATE_ROI');
  const active=[];
  for(let ty=0;ty<templateHeight;ty++)
    for(let tx=0;tx<templateWidth;tx++){
      const offset=(ty*templateWidth+tx)*4;
      if(template[offset+3]!==0)active.push({tx,ty,offset});
    }
  const unknown=(reason,score=0,margin=0)=>({
    label:'UNKNOWN',reason,x:null,y:null,score,margin,
  });
  if(!active.length)return unknown('EMPTY_TEMPLATE');
  const candidates=[];
  const maxY=region.y+region.height-templateHeight;
  const maxX=region.x+region.width-templateWidth;
  for(let y=region.y;y<=maxY;y+=stride)
    for(let x=region.x;x<=maxX;x+=stride){
      let error=0;
      for(const {tx,ty,offset} of active){
        const i=((y+ty)*width+x+tx)*4;
        error+=Math.abs(rgba[i]-template[offset])+
          Math.abs(rgba[i+1]-template[offset+1])+
          Math.abs(rgba[i+2]-template[offset+2]);
      }
      candidates.push({x,y,score:1-error/(active.length*3*255)});
    }
  candidates.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);
  const best=candidates[0];
  const other=candidates.find(p=>Math.abs(p.x-best.x)>=templateWidth||
    Math.abs(p.y-best.y)>=templateHeight);
  const margin=best.score-(other?.score??0);
  if(best.score<minScore)return unknown('WEAK_MATCH',best.score,margin);
  if(margin<minMargin)return unknown('AMBIGUOUS_MATCH',best.score,margin);
  return {label:'MATCH',reason:'DISTINCT_TEMPLATE',x:best.x,y:best.y,
    score:best.score,margin};
}
