/** Only verified, consecutive PIXEL observations can unlock water crossing.
 * Boss disappearance alone is NOT evidence of a kill (occlusion/camera scroll).
 * The existing combat policy remains in control until this gate opens.
 */
const integer = (n, min=0) => Number.isSafeInteger(n) && n >= min;

export function createBossDefeatGate({minConfidence=0.95,confirmations=2,
  maxFrameGap=12}={}) {
  if (typeof minConfidence!=='number'||minConfidence<=0||minConfidence>1||
      !integer(confirmations,2)||!integer(maxFrameGap,1))
    throw Error('BOT_BOSS_GATE_OPTIONS');
  let last=null,consecutive=0,cleared=false,stopped=null;
  function reset(){last=null;consecutive=0;cleared=false;stopped=null;}
  function observe(o) {
    if (!o||!integer(o.frame)||typeof o.session!=='string'||!o.session||
        !((typeof o.lifeKey==='string'&&o.lifeKey)||integer(o.lifeKey)))
      throw Error('BOT_BOSS_GATE_OBSERVATION');
    if(stopped)return {phase:'STOP',reason:stopped};
    if(last&&(o.session!==last.session||o.lifeKey!==last.lifeKey)){
      stopped='SESSION_OR_LIFE_CHANGED';
      return {phase:'STOP',reason:stopped};
    }
    if(last&&(o.frame<=last.frame||o.frame-last.frame>maxFrameGap)){
      stopped='STALE_OR_GAPPED_FRAME';
      return {phase:'STOP',reason:stopped};
    }
    last={session:o.session,lifeKey:o.lifeKey,frame:o.frame};
    if(o.playing!==true){stopped='NOT_PLAYING';return {phase:'STOP',reason:stopped};}
    if(cleared)return {phase:'BOSS_DEFEATED',reason:'PREVIOUSLY_VISUALLY_CONFIRMED'};
    const boss=o.boss;
    // Upstream detection must distinguish an actual kill animation from
    // invisibility. No live RAM, phase bytes or inferred disappearance.
    const verified=boss?.status==='DEFEATED'&&boss.evidence==='KILL_ANIMATION'&&
      typeof boss.confidence==='number'&&boss.confidence>=minConfidence&&
      boss.confidence<=1;
    consecutive=verified?consecutive+1:0;
    if(consecutive>=confirmations){
      cleared=true;
      return {phase:'BOSS_DEFEATED',reason:'KILL_ANIMATION_CONFIRMED'};
    }
    return {phase:'BOSS_COMBAT',reason:verified?
      'AWAITING_SECOND_KILL_WITNESS':'KILL_NOT_CONFIRMED'};
  }
  return {observe,reset};
}
