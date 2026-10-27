/** First rendered VBlank is the only legal moment to continue the attract
 * sequence. The HTTP server may be listening before this gate is armed.
 * Read-only polling; no P1, Coin, Start or reset.
 */
export async function waitForAttractGate({
  readState,sleep,maxPolls=300,pollMs=100,shouldStop=()=>false,
}={}){
  if(typeof readState!=='function'||typeof sleep!=='function'||
     typeof shouldStop!=='function'||
     !Number.isSafeInteger(maxPolls)||maxPolls<1||maxPolls>1000||
     !Number.isSafeInteger(pollMs)||pollMs<1||pollMs>10000)
    throw Error('BOT_DEMO_GATE_OPTIONS');
  let expectedSession=null;
  for(let i=0;i<maxPolls;i++){
    if(shouldStop())throw Error('BOT_DEMO_GATE_OPERATOR_CANCELLED');
    const s=await readState();
    if(!s||!Number.isSafeInteger(s.sessionId)||s.sessionId<1||
       !Number.isSafeInteger(s.frame)||s.frame<0)
      throw Error('BOT_DEMO_GATE_INVALID_STATE');
    if(expectedSession===null)expectedSession=s.sessionId;
    if(expectedSession!==s.sessionId)
      throw Error('BOT_DEMO_GATE_SESSION_CHANGED');
    if(s.halt)throw Error('BOT_DEMO_GATE_ENGINE_HALT_'+
      String(s.halt.status??s.halt.code??'UNKNOWN'));
    if(s.operatorPause===true)
      return {sessionId:s.sessionId,frame:s.frame,
        lastRenderedFrame:s.lastRenderedFrame??null,polls:i+1};
    if(i+1<maxPolls)await sleep(pollMs);
  }
  throw Error('BOT_DEMO_GATE_WAIT_TIMEOUT');
}
