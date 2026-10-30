/** gngb RAM interpretation, read only: UI state and labels for evaluation.
 * Addresses are main-CPU work RAM, which starts the board frame record.
 * End-of-game screens keep main mode 2.
 */
import {REC} from '../../boards/gng/frame-record.mjs';

export const RAM=Object.freeze({mode:0x02,phase:0x05,credits:0x22,stage:0x52,
  lives:0x60,world:0xa0,y:0xa2});
export const BOSS_LIFE=0x0e76;

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
  const {mode:m,phase:p,credits:c}=RAM;
  if(![m,p,c,c+1].every(a=>frame.known[a]===255))return null;
  const mode=frame.record[m],phase=frame.record[p];
  const credits=frame.record[c]*256+frame.record[c+1];
  const canContinue=mode===2&&phase===4;
  const gameOver=mode===2&&(phase>=2||hasGameOver(frame));
  return {credits,canContinue,gameOver,inGame:mode>=2&&!gameOver,
    readyToStart:credits>0&&(mode===1||canContinue)};
}

/** Player position, lives and stage. `known` covers world, y and lives;
 * `stageKnown` covers the stage byte. */
export function playerLabels({record:b,known:k}){
  const {world,y,lives,stage}=RAM;
  return {known:[world,world+1,y,y+1,lives].every(a=>k[a]===255),
    stageKnown:k[stage]===255,
    world:b[world]*256+b[world+1],y:b[y]*256+b[y+1],lives:b[lives],stage:b[stage]};
}

/** Exploration labels of one 0x600-byte work RAM view. */
export const look=b=>({phase:b[0x72],cp:b[0x81],loop:b[0x71],lives:b[RAM.lives],
  x:b[0xa0]<<8|b[0xa1],y:b[0xa2]<<8|b[0xa3],scroll:b[0x58]<<8|b[0x59],armor:b[0xac],
  mode:b[0x503],handler:b[0x510]<<8|b[0x511]});
