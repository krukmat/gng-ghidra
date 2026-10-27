/** Compare current REAL RGBA with the pre-existing offline witness.
 * This is a consistency check, not proof of boss defeat or player health.
 */
export function comparePracticeWitness(actual,reference,{width=256,height=224,
  rowStart=78,rowEnd=216,tolerance=55,minAgreement=0.55}={}){
  if(!(actual instanceof Uint8Array||Buffer.isBuffer(actual))||
     !(reference instanceof Uint8Array||Buffer.isBuffer(reference))||
     actual.length!==width*height*4||reference.length!==actual.length)
    throw Error('BOT_PRACTICE_WITNESS_PIXELS_INVALID');
  if(!Number.isSafeInteger(rowStart)||rowStart<0||rowEnd>=height||
     rowStart>rowEnd||typeof tolerance!=='number'||tolerance<0||
     typeof minAgreement!=='number'||minAgreement<=0||minAgreement>1)
    throw Error('BOT_PRACTICE_WITNESS_OPTIONS');
  let matches=0,total=0;
  // Subsample every second pixel to reduce memory cost. Compare visual
  // scene structure; avoid HUD, splash text, and engine state assumptions.
  for(let y=rowStart;y<=rowEnd;y+=2)for(let x=0;x<width;x+=2){
    const i=(y*width+x)*4;
    const distance=Math.abs(actual[i]-reference[i])+
      Math.abs(actual[i+1]-reference[i+1])+
      Math.abs(actual[i+2]-reference[i+2]);
    if(distance<=tolerance)matches++;
    total++;
  }
  const agreement=matches/total;
  return {status:agreement>=minAgreement?'SCENE_MATCH_CANDIDATE':
    'SCENE_MISMATCH',agreement,
    checkedPixels:total,threshold:minAgreement,notProofOfLife:true};
}
