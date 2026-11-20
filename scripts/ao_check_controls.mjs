/** Keep a real player alive while browser checks wait for periodic saving.
 * Face both sides and fire: standing still leaves the player's back exposed. */
export async function defendUntil(page,done,timeoutMs=45000){
  const deadline=Date.now()+timeoutMs;
  await page.keyboard.down('KeyZ');
  try{
    let left=true;
    while(!await done()){
      if(Date.now()>deadline)throw Error('AO_DEFEND_TIMEOUT');
      const direction=left?'ArrowLeft':'ArrowRight';left=!left;
      await page.keyboard.down(direction);await page.waitForTimeout(100);
      await page.keyboard.up(direction);await page.waitForTimeout(400);
    }
  }finally{
    for(const key of ['KeyZ','ArrowLeft','ArrowRight'])await page.keyboard.up(key);
  }
}
