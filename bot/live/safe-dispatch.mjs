/** Existing /input port bridge, fail-closed on unverified visuals.
 * Never invents deaths, lives, score, or stage; never sends Coin/Start.
 */
const ALLOWED=new Set(['p1.right','p1.left','p1.button1','p1.button2']);
export async function dispatchVerifiedP1({decision,evidence,sessionId,
  base='http://127.0.0.1:18609',fetchImpl=fetch}={}){
  const stop=reason=>({status:'STOP_NO_INPUT',reason});
  if(!Number.isSafeInteger(sessionId)||sessionId<0)
    return stop('SESSION_UNVERIFIED');
  if(!decision||!['ISLAND','MAINLAND'].includes(decision.stage)||
     !Array.isArray(decision.commands))return stop('INVALID_STAGE');
  if(!evidence||evidence.bossDefeated!==true||
     evidence.lifeConfirmed!==true||evidence.pixelsCalibrated!==true||
     evidence.terrainCalibrated!==true||evidence.groundedConfirmed!==true)
    return stop('INSUFFICIENT_VISUAL_EVIDENCE');
  if(decision.commands.some(c=>!c||!ALLOWED.has(c.control)||
    typeof c.pressed!=='boolean'))return stop('UNAUTHORIZED_CONTROL');
  if(new Set(decision.commands.map(c=>c.control)).size!==decision.commands.length)
    return stop('DUPLICATE_CONTROL');
  const sr=await fetchImpl(base+'/state',{cache:'no-store'});
  if(!sr.ok)return stop('STATE_FETCH_FAILED');
  const state=await sr.json();
  if(state.halt||state.operatorPause||state.sessionId!==sessionId)
    return stop('LIVE_STATE_CHANGED');
  let applied=0;
  try{
    for(const command of decision.commands){
      const result=await fetchImpl(base+'/input',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(command)});
      if(!result.ok)throw Error('INPUT_REJECTED_'+result.status);
      applied++;
    }
  }catch(error){
    await fetchImpl(base+'/release',{method:'POST'}).catch(()=>{});
    return stop('INPUT_FAILURE_RELEASED_'+String(error.message??error));
  }
  return {status:'COMMANDS_SENT',count:applied};
}
