/** ROM-free planning/validation for a live port-tape practice handoff.
 * Does not patch the engine, inspect RAM or fabricate a boss kill.
 */
export function buildPracticePlayback(events,cyclesPerFrame,targetFrame){
  if(!Array.isArray(events)||!Number.isSafeInteger(cyclesPerFrame)||
     cyclesPerFrame<1||!Number.isSafeInteger(targetFrame)||
     targetFrame<1200||targetFrame>10000)
    throw Error('BOT_PRACTICE_CONFIG');
  let prior=-1;
  const plan=[];
  for(const event of events){
    if(!Number.isSafeInteger(event?.cycle)||event.cycle<0||
       event.cycle<prior||typeof event.control!=='string'||
       typeof event.pressed!=='boolean'||
       event.cycle%cyclesPerFrame!==0)
      throw Error('BOT_PRACTICE_TAPE_INVALID');
    prior=event.cycle;
    const frame=event.cycle/cyclesPerFrame;
    if(frame>=targetFrame)break;
    plan.push({frame,control:event.control,pressed:event.pressed});
  }
  if(!plan.some(e=>e.control==='start1'&&e.pressed))
    throw Error('BOT_PRACTICE_NO_START');
  // Release first to preserve 4-way joystick safety. Separate live POSTs
  // are not atomic; their effective CPU reads must be checked against /tape.
  plan.sort((a,b)=>a.frame-b.frame||
    Number(a.pressed)-Number(b.pressed)||a.control.localeCompare(b.control));
  return plan;
}
export function playbackDue(plan,index,currentFrame,targetFrame,
  {maxLagFrames=8}={}){
  if(!Array.isArray(plan)||!Number.isSafeInteger(index)||index<0||
     index>plan.length||!Number.isSafeInteger(currentFrame)||
     currentFrame<0||!Number.isSafeInteger(targetFrame)||
     !Number.isSafeInteger(maxLagFrames)||maxLagFrames<0)
    throw Error('BOT_PRACTICE_TICK');
  const due=[];
  // Snapshot F is emitted at cycle F*cyclesPerFrame-1. Inputs scheduled
  // for F*cyclesPerFrame belong AFTER snapshot F, never snapshot F-1.
  while(index<plan.length&&currentFrame>=plan[index].frame){
    const event=plan[index];
    const lag=currentFrame-event.frame;
    if(lag>maxLagFrames)
      return {status:'LAG_STOP',index,lateEvent:event,lag,due:[]};
    due.push(event);index++;
  }
  return {status:currentFrame>=targetFrame?'HANDOFF': 'PLAYING',
    index,due};
}
