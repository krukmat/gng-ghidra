/** Stage-1 red/blue demon pixel CANDIDATE; sprite absence is UNKNOWN,
 * never proof of defeat (it could leave viewport or be occluded).
 */
const isRed=(r,g,b)=>r>=100&&r>g*1.6&&r>b*1.5&&g<=100;
const isBlue=(r,g,b)=>b>=95&&b>r*1.3&&b>g*1.1;
export function detectRedDemon({rgba,width=256,height=224,
  top=110,bottom=189,minBluePixels=40}={}){
  if(!(rgba instanceof Uint8Array||rgba instanceof Uint8ClampedArray)||
     rgba.length!==width*height*4||top<0||bottom>=height||top>=bottom)
    throw Error('BOT_DEMON_PIXEL_INPUT');
  const counts=Array(width).fill(0),ys=Array.from({length:width},()=>[]);
  for(let y=top;y<=bottom;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    if(isRed(rgba[i],rgba[i+1],rgba[i+2])){
      counts[x]++;ys[x].push(y);
    }
  }
  const hits=counts.map((n,x)=>n>=2?x:null).filter(x=>x!==null);
  const shapes=[];
  if(hits.length){
    let left=hits[0],right=left;
    function add(){
      if(right-left<5||right-left>22)return;
      let reds=0,redY=height;
      for(let x=left;x<=right;x++){
        reds+=counts[x];
        if(ys[x].length)redY=Math.min(redY,...ys[x]);
      }
      if(reds<18)return;
      let blues=0;
      for(let y=redY;y<Math.min(height,redY+40);y++)
        for(let x=Math.max(0,left-6);x<=Math.min(width-1,right+6);x++){
          const i=(y*width+x)*4;
          if(isBlue(rgba[i],rgba[i+1],rgba[i+2]))blues++;
        }
      if(blues>=minBluePixels)shapes.push({left,right,redY,reds,blues});
    }
    for(const x of hits.slice(1)){
      if(x-right>3){add();left=x;}right=x;
    }
    add();
  }
  shapes.sort((a,b)=>b.blues-a.blues);
  if(shapes.length!==1)return {status:'UNKNOWN',
    reason:shapes.length?'MULTIPLE_DEMON_CANDIDATES':
      'NOT_VISIBLE_OR_NOT_IDENTIFIABLE',candidates:shapes};
  return {status:'VISIBLE_CANDIDATE',...shapes[0],verified:false,
    defeat:'UNKNOWN'};
}
