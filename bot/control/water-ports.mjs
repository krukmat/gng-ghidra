/** Translate water-policy actions to ORIGINAL P1 press/release commands.
 * No network traffic, engine calls, new controls, or automatic credits.
 * The caller posts each returned command to the existing /input endpoint.
 */
const ACTIONS=Object.freeze({
  neutral:[],right:['p1.right'],right_jump:['p1.right','p1.button2'],
});
const CONTROLS=['p1.right','p1.button2'];
export function createWaterPortAdapter(){
  const held=new Set();
  let session=null,stopped=false;
  function transitions(want){
    const desired=new Set(want);
    const commands=[];
    // Release first to prevent accidental simultaneous holds across actions.
    for(const control of CONTROLS)
      if(held.has(control)&&!desired.has(control)){
        commands.push({control,pressed:false});held.delete(control);
      }
    for(const control of CONTROLS)
      if(!held.has(control)&&desired.has(control)){
        commands.push({control,pressed:true});held.add(control);
      }
    return commands;
  }
  function step({session:nextSession,action='neutral',phase='STOP'}={}){
    if(typeof nextSession!=='string'||!nextSession||
       !Object.hasOwn(ACTIONS,action))throw Error('BOT_WATER_PORT_ACTION');
    if(session!==null&&session!==nextSession){
      stopped=true;
      session=nextSession;
      return {commands:transitions([]),status:'SESSION_CHANGED_RESET_REQUIRED'};
    }
    session=nextSession;
    if(stopped)return {commands:transitions([]),status:'RESET_REQUIRED'};
    if(phase==='STOP'||phase==='LANDED'){
      stopped=true;
      return {commands:transitions([]),status:phase};
    }
    if(phase==='OUTSIDE_ZONE')return {
      commands:transitions([]),status:'PARENT_POLICY_CONTROL'};
    return {commands:transitions(ACTIONS[action]),status:'ACTIVE'};
  }
  function reset(){const commands=transitions([]);session=null;stopped=false;
    return commands;}
  return {step,reset};
}
