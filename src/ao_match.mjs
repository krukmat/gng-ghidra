/** Two-player match on one set of controls (games/gngb/state.mjs): follows
 * the game-state updates and reports when a two-player game starts, whose
 * turn it is once play resumes, and the result when the game returns to the
 * title. A game only counts when it starts from the title: the power-on RAM
 * test fills the same bytes with patterns. Pure: the app (and later netplay)
 * turns the events into UI. */
const scoresOf=s=>s.scores?.length===2&&s.scores.every(Number.isInteger)?s.scores:null;
export function createMatchTracker(){
  let match=null,armed=false; // armed: the title was seen since the last game
  return {
    update(s){
      if(!s)return [];
      const events=[];
      if(match&&s.mode<2){
        if(match.scores){
          const [a,b]=match.scores;
          events.push({type:'result',scores:match.scores,winner:a>b?1:b>a?2:0});
        }
        match=null;
      }
      if(s.mode===1)armed=true;
      else if(s.mode>=2&&match){
        match.scores=scoresOf(s)??match.scores;
        // A turn passes while play is stopped; announce it when play resumes.
        if(s.inGame&&s.player!==match.player){
          match.player=s.player;events.push({type:'turn',player:s.player});
        }
      }else if(s.mode>=2&&armed&&s.players!==undefined){
        armed=false;
        if(s.players===2){
          match={player:s.player,scores:scoresOf(s)};
          events.push({type:'start',player:s.player});
        }
      }
      return events;
    },
    reset(){match=null;armed=false;},
  };
}
