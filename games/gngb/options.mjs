/** Game options chosen before a session (Reiniciar or a two-player start):
 * the original DIP switches (lives, difficulty) and one assist that the
 * original game does not have, the enemy pace. Checkpoints and tapes carry
 * them, so a session always replays with the options it was played with.
 *
 * Enemy pace: the enemy loop (ROM 0xA0AB) walks 40 object slots of 0x30
 * bytes from RAM 0x0880 and calls each slot's per-type handler with
 * JSR [B,U] at 0xA0C7 (block 0xA0C1, table 0x4544 in the stage bank).
 * Arthur (0x0500) and his weapons live outside those slots. Skipping that
 * call on some frames slows enemies, their shots and bosses; the player is
 * untouched. A skipped call resumes at 0xA0C9, the return address, as if the
 * handler had returned at once; the per-slot routine at 0xA0D1 still runs.
 * The choice reads only RAM (frame counter 0x21, slot counter 0xE0), so a
 * paced session is as deterministic as the original. Stage 1 zombies on
 * the shipped bundle: 0.50 px/frame at 100 %, 0.37 at 75 %, 0.23 at 50 %,
 * with Arthur at the same place every frame (scripts/gng_options_check.mjs).
 */
import {dipSwitches,LIVES,DIFFICULTIES} from './inputs.mjs';

export const ENEMY_PACES=Object.freeze([100,75,50]);
export const DEFAULT_OPTIONS=Object.freeze({lives:3,difficulty:'normal',enemyPace:100});
const ENEMY_CALL=0xa0c1,ENEMY_RETURN=0xa0c9;
const SKIP=Object.freeze({75:t=>(t&3)===0,50:t=>(t&1)===0});
// Block keys: the board's code identity for fixed ROM (boards/gng/code-view.mjs:
// space 'fixed', context 'main', overlay 0, then the PC); the frozen
// reference bundles key blocks by the bare PC.
const blockKey=(blocks,pc)=>blocks.has(pc)?pc:`fixed\u0000main\u00000\u0000${pc}`;

/** Validated copy; missing fields take the defaults (older checkpoints). */
export function gameOptions(o){
  const out={...DEFAULT_OPTIONS,...(o??{})},lives=Number(out.lives);
  if(!Object.hasOwn(LIVES,lives)||!Object.hasOwn(DIFFICULTIES,out.difficulty)||
     !ENEMY_PACES.includes(out.enemyPace))
    throw Error('GNG_OPTIONS_INVALID');
  return Object.freeze({lives,difficulty:out.difficulty,enemyPace:out.enemyPace});
}
export const optionDips=o=>dipSwitches(gameOptions(o));

/** The program blocks with the enemy pace applied (the same Map at 100 %). */
export function withEnemyPace(blocks,pace){
  if(!ENEMY_PACES.includes(pace))throw Error('GNG_ENEMY_PACE_INVALID');
  if(pace===100)return blocks;
  const key=blockKey(blocks,ENEMY_CALL),call=blocks.get(key),skip=SKIP[pace];
  if(typeof call!=='function')throw Error('GNG_ENEMY_PACE_BLOCK_MISSING');
  const paced=new Map(blocks);
  paced.set(key,$=>{
    if($.PC===ENEMY_CALL&&skip($.rd(0x21)+$.rd(0xe0))){
      $.C+=10;$.PC=ENEMY_RETURN;return;
    }
    return call($);
  });
  return paced;
}
