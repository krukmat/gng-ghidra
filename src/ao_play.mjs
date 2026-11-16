/** One user action starts or continues a game. Credit pulses stay internal;
 * Start waits for the ROM to count them. Cancel when leaving the session. */
export function createPlayStarter({pulse,onChange=()=>{},onTimeout=()=>{}}){
  let pending=null;
  const cancel=()=>{
    if(!pending)return;
    clearTimeout(pending.timer);pending=null;onChange();
  };
  const update=state=>{
    if(!pending)return;
    if(state.inGame){cancel();return;}
    if(pending.continuing&&!state.canContinue){cancel();return;}
    if(pending.sent)return;
    if((state.mode===1||pending.continuing)&&state.credits>=pending.players){
      pending.sent=true;
      if(pulse(pending.continuing?'continue1':pending.players===2?'start2':'start1')===false)
        cancel();
    }
  };
  return {
    get busy(){return pending!==null;},
    request(state,players=1){
      if(pending||state.inGame||![1,2].includes(players)||
         !(state.mode===0||state.mode===1||players===1&&state.canContinue))return false;
      pending={players,continuing:!!state.canContinue,sent:false,timer:setTimeout(()=>{
        cancel();onTimeout();
      },5000)};
      for(let n=state.credits;n<players;n++){
        if(pulse('coin1')===false){cancel();return false;}
      }
      onChange();update(state);return true;
    },
    update,cancel
  };
}
