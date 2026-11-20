/** gngb RAM interpretation, read only: UI state and labels for evaluation.
 * Addresses are main-CPU work RAM, which starts the board frame record.
 * End-of-game screens keep main mode 2.
 */
import {REC} from '../../boards/gng/frame-record.mjs';

export const RAM=Object.freeze({mode:0x02,phase:0x05,credits:0x22,
  twoPlayers:0x26,turn:0x27,stage:0x52,lives:0x60,score:0x68,world:0xa0,y:0xa2,
  armor:0xac,waiting:0x440});
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

const bcd=(b,at,n)=>{
  let v=0;
  for(let i=0;i<n;i++){
    const x=b[at+i];
    if((x>>4)>9||(x&15)>9)return null;
    v=v*100+(x>>4)*10+(x&15);
  }
  return v;
};
/** Two-player games alternate turns on the P1 controls (upright cabinet).
 * RAM 0x26 is 1 in a two-player game and 0x27 the player whose turn it is
 * (0 = P1). The player block 0x60-0x8F holds the current player's lives (+0)
 * and score (+8, 4 BCD bytes); the other player's copy waits at 0x440. After
 * the game the title (mode 1) keeps both scores until the demo starts. */
function playerState({record:b,known:k}){
  const {twoPlayers,turn,score,waiting}=RAM;
  const bytes=[twoPlayers,turn,...[0,1,2,3].flatMap(i=>[score+i,waiting+8+i])];
  if(!bytes.every(a=>k[a]===255))return {};
  const players=b[twoPlayers]?2:1,turnOf=b[turn]&1;
  const own=bcd(b,score,4),other=bcd(b,waiting+8,4);
  const livesKnown=k[RAM.lives]===255&&(players===1||k[waiting]===255);
  const ownLives=b[RAM.lives],otherLives=b[waiting];
  return {players,player:turnOf+1,
    ...(livesKnown?{lives:players===1?[ownLives]:turnOf===0?
      [ownLives,otherLives]:[otherLives,ownLives]}:{}),
    scores:players===1?[own]:turnOf===0?[own,other]:[other,own]};
}

// Avoid recovery points during collision or death animations. A collision
// may only remove armour: the life counters decide when recovery is needed.
function playerHurt({record:b,known:k}){
  if(![RAM.armor,0x503,0x510,0x511].every(a=>k[a]===255))return undefined;
  const handler=b[0x510]<<8|b[0x511];
  return b[0x503]===3||handler===0x8e05||
    (handler&0xffe0)===0x9c40||handler===0x9c64;
}

/** Lives are indexed by player, even while the ROM swaps their RAM blocks. */
export function lostLife(previous,state){
  if(previous?.mode!==2||!state||
    previous.players!==state?.players)return null;
  const index=state.lives?.findIndex((n,i)=>Number.isInteger(previous.lives?.[i])&&
    n<previous.lives[i]);
  return index>=0?index+1:null;
}

/** Only living gameplay may replace the automatic recovery point. Reads
 * work RAM only: valid for both frame records and exported CPU memory. */
export function canAutosave(frame,previous=null){
  const {record:b,known:k}=frame;
  const state={mode:b[RAM.mode],...playerState(frame)};
  return k[RAM.mode]===255&&k[RAM.phase]===255&&state.mode===2&&
    b[RAM.phase]<2&&playerHurt(frame)===false&&
    state.lives?.[state.player-1]>0&&!lostLife(previous,state);
}

/** Manual checkpoints may include menus, but active play must resume from a
 * living, stable frame. This also protects older saves made during a death. */
export function canResumeCheckpoint(frame){
  return frame.known[RAM.mode]===255&&
    (frame.record[RAM.mode]!==2||canAutosave(frame));
}

export function observeGameState(frame){
  const {mode:m,phase:p,credits:c}=RAM;
  if(![m,p,c,c+1].every(a=>frame.known[a]===255))return null;
  const mode=frame.record[m],phase=frame.record[p];
  const credits=frame.record[c]*256+frame.record[c+1];
  const canContinue=mode===2&&phase===4;
  const gameOver=mode===2&&(phase>=2||hasGameOver(frame));
  return {mode,credits,canContinue,gameOver,inGame:mode>=2&&!gameOver,
    readyToStart:credits>0&&(mode===1||canContinue),hurt:playerHurt(frame),
    ...playerState(frame)};
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
  x:b[0xa0]<<8|b[0xa1],y:b[0xa2]<<8|b[0xa3],scroll:b[0x58]<<8|b[0x59],armor:b[RAM.armor],
  mode:b[0x503],handler:b[0x510]<<8|b[0x511]});
