/** Private replay contact-sheet PNG decoder: 8-bit RGBA, filter 0 only.
 * Deliberately narrow; rejects unsupported images. Uses no ROM or engine.
 */
import {inflateSync} from 'node:zlib';
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
export function readReplayContactPng(data){
  const b=Buffer.from(data);
  if(b.length<45||!b.subarray(0,8).equals(SIGNATURE))
    throw Error('BOT_CONTACT_PNG_SIGNATURE');
  let offset=8,width=null,height=null,ended=false;
  const idat=[];
  while(offset+12<=b.length){
    const length=b.readUInt32BE(offset);
    const type=b.toString('ascii',offset+4,offset+8);
    if(length>16*1024*1024||offset+12+length>b.length)
      throw Error('BOT_CONTACT_PNG_CHUNK');
    const payload=b.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){
      if(length!==13||width!==null)throw Error('BOT_CONTACT_PNG_HEADER');
      width=payload.readUInt32BE(0);height=payload.readUInt32BE(4);
      if(width<256||height<224||width*height>3000000||
         payload[8]!==8||payload[9]!==6||payload[12]!==0)
        throw Error('BOT_CONTACT_PNG_FORMAT');
    }else if(type==='IDAT')idat.push(payload);
    else if(type==='IEND'){ended=true;break;}
    offset+=12+length;
  }
  if(!ended||!idat.length||width===null)
    throw Error('BOT_CONTACT_PNG_INCOMPLETE');
  const stride=width*4;
  const raw=inflateSync(Buffer.concat(idat),
    {maxOutputLength:(stride+1)*height});
  if(raw.length!==(stride+1)*height)throw Error('BOT_CONTACT_PNG_SIZE');
  const rgba=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++){
    const pos=y*(stride+1);
    if(raw[pos]!==0)throw Error('BOT_CONTACT_PNG_FILTER_UNSUPPORTED');
    rgba.set(raw.subarray(pos+1,pos+1+stride),y*stride);
  }
  return {width,height,rgba};
}
export function replayContactFrame(contact,index,{columns=4,
  frameWidth=256,frameHeight=224,gap=4}={}){
  if(!Number.isSafeInteger(index)||index<0||
    !Number.isSafeInteger(columns)||columns<1)
    throw Error('BOT_CONTACT_FRAME_INDEX');
  const x=(index%columns)*(frameWidth+gap);
  const y=Math.floor(index/columns)*(frameHeight+gap);
  if(x+frameWidth>contact.width||y+frameHeight>contact.height)
    throw Error('BOT_CONTACT_FRAME_MISSING');
  const rgba=new Uint8Array(frameWidth*frameHeight*4);
  for(let row=0;row<frameHeight;row++){
    const start=((y+row)*contact.width+x)*4;
    rgba.set(contact.rgba.subarray(start,start+frameWidth*4),
      row*frameWidth*4);
  }
  return {rgba,width:frameWidth,height:frameHeight};
}
