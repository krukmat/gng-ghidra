/** Read-only UI state for gngb. End-of-game screens keep main mode 2. */
import {REC} from './gngb_render_inputs.mjs';

function hasGameOver({record,known}){
  const text='GAME OVER';
  for(let i=0;i<0x400-text.length+1;i++){
    if(i%32+text.length>32||record[REC.fg+i]!==71)continue;
    let matches=true;
    for(let j=0;j<text.length&&matches;j++){
      const code=REC.fg+i+j,attr=code+0x400;
      matches=known[code]===255&&known[attr]===255&&
        record[code]===text.charCodeAt(j)&&(record[attr]&0xc0)===0;
    }
    if(matches)return true;
  }
  return false;
}

export function observeGameState(frame){
  if(![2,5,0x22,0x23].every(a=>frame.known[a]===255))return null;
  const mode=frame.record[2],phase=frame.record[5];
  const credits=frame.record[0x22]*256+frame.record[0x23];
  const canContinue=mode===2&&phase===4;
  const gameOver=mode===2&&(phase>=2||hasGameOver(frame));
  return {credits,canContinue,gameOver,inGame:mode>=2&&!gameOver,
    readyToStart:credits>0&&(mode===1||canContinue)};
}
