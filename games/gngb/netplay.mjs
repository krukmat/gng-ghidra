/** GnG netplay rule for src/netplay_turns.mjs: the owner of the next frame
 * from the RAM at the end of this one. P2's turn (RAM 0x27 = 1) in a game
 * (mode >= 2) belongs to the guest once the title has been seen; the
 * power-on RAM test (which fills those bytes with patterns), the title,
 * coins, Start and P1's turns belong to the host. */
import {RAM} from './state.mjs';

export function createGngTurnRule(){
  let titleSeen=false;
  return ram=>{
    if(ram[RAM.mode]===1)titleSeen=true;
    return titleSeen&&ram[RAM.mode]>=2&&ram[RAM.turn]===1?'guest':'host';
  };
}
