/** Game rules for a session: the original DIP switches (lives, difficulty),
 * enemy pace, shared progress, armor and lives spent when resuming.
 * Checkpoints and tapes carry these rules for playback.
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
 *
 * Cooperative two players (`coop`): the turns still alternate, each player
 * with their own lives and score, but both advance one shared game. See
 * withSharedProgress.
 */
import {dipSwitches,LIVES,DIFFICULTIES} from './inputs.mjs';
import {RAM} from './state.mjs';

export const ENEMY_PACES=Object.freeze([100,75,50]);
export const DEFAULT_OPTIONS=Object.freeze({lives:3,difficulty:'normal',enemyPace:100});
// The menu exposes one difficulty; saves and replays retain the exact DIP
// and pace values, including combinations chosen before the unified menu.
export const DIFFICULTY_LEVELS=Object.freeze({
  easiest:Object.freeze({difficulty:'easy',enemyPace:50}),
  easy:Object.freeze({difficulty:'easy',enemyPace:75}),
  normal:Object.freeze({difficulty:'normal',enemyPace:100}),
  hard:Object.freeze({difficulty:'hard',enemyPace:100}),
  hardest:Object.freeze({difficulty:'hardest',enemyPace:100})
});
export function difficultyOptions(level,{lives=DEFAULT_OPTIONS.lives,coop}={}){
  if(!Object.hasOwn(DIFFICULTY_LEVELS,level))throw Error('GNG_OPTIONS_INVALID');
  return gameOptions({lives,coop,...DIFFICULTY_LEVELS[level]});
}
/** null means a legacy combination, which must replay without conversion. */
export function difficultyLevel(options){
  const o=gameOptions(options);
  return Object.keys(DIFFICULTY_LEVELS).find(level=>{
    const p=DIFFICULTY_LEVELS[level];
    return p.difficulty===o.difficulty&&p.enemyPace===o.enemyPace;
  })??null;
}
const ENEMY_CALL=0xa0c1,ENEMY_RETURN=0xa0c9;
const SKIP=Object.freeze({75:t=>(t&3)===0,50:t=>(t&1)===0});
// Block keys: the board's code identity for fixed ROM (boards/gng/code-view.mjs:
// space 'fixed', context 'main', overlay 0, then the PC); the frozen
// reference bundles key blocks by the bare PC.
const blockKey=(blocks,pc)=>blocks.has(pc)?pc:`fixed\u0000main\u00000\u0000${pc}`;

/** Validated copy; missing fields take the defaults (older checkpoints).
 * `coop` is only kept when true, so every other game keeps its exact options. */
export function gameOptions(o){
  const out={...DEFAULT_OPTIONS,...(o??{})},lives=Number(out.lives);
  const armorFrames=out.recoveryArmorFrames??[];
  const lifeLosses=out.recoveryLifeLosses??[];
  if(!Object.hasOwn(LIVES,lives)||!Object.hasOwn(DIFFICULTIES,out.difficulty)||
     !ENEMY_PACES.includes(out.enemyPace)||
     out.continues!==undefined&&typeof out.continues!=='boolean'||
     out.coop!==undefined&&typeof out.coop!=='boolean'||
     !Array.isArray(armorFrames)||armorFrames.some((frame,i)=>
       !Number.isSafeInteger(frame)||frame<1||(i>0&&frame<=armorFrames[i-1]))||
     !Array.isArray(lifeLosses)||lifeLosses.some((entry,i)=>
       !Array.isArray(entry)||entry.length!==3||
       !Number.isSafeInteger(entry[0])||entry[0]<1||
       !Number.isInteger(entry[1])||entry[1]<1||entry[1]>2||
       !Number.isInteger(entry[2])||entry[2]<1||entry[2]>lives||
       i>0&&(entry[0]<lifeLosses[i-1][0]||
         entry[0]===lifeLosses[i-1][0]&&entry[1]<=lifeLosses[i-1][1])))
    throw Error('GNG_OPTIONS_INVALID');
  return Object.freeze({lives,difficulty:out.difficulty,enemyPace:out.enemyPace,
    ...(out.continues===undefined?{}:{continues:out.continues}),
    ...(out.coop===true?{coop:true}:{}),
    ...(armorFrames.length?{recoveryArmorFrames:Object.freeze([...armorFrames])}:{}),
    ...(lifeLosses.length?{recoveryLifeLosses:Object.freeze(
      lifeLosses.map(entry=>Object.freeze([...entry])))}:{})});
}
/** Add one death to a recovery point without changing its saved CPU state. */
export function addRecoveryLifeLoss(options,frame,player){
  const current=gameOptions(options),losses=(current.recoveryLifeLosses??[])
    .map(entry=>[...entry]);
  const existing=losses.find(entry=>entry[0]===frame&&entry[1]===player);
  if(existing)existing[2]++;
  else losses.push([frame,player,1]);
  losses.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  return gameOptions({...current,recoveryLifeLosses:losses});
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

/** Cooperative two players. The ROM keeps the playing player's game in the
 * block 0x60-0x8F and the waiting player's in 0x440-0x46F, and swaps them at
 * 0x77EC when the turn passes: after a death while the other player has lives
 * (JSR at 0x77E0) and when a player runs out of lives (JMP from 0x7902).
 * Just before that swap, the leaving player's game is copied over the waiting
 * one, except for what stays personal: lives (+0x00), the extra-life
 * bookkeeping (+0x02..+0x07) and the score (+0x08..+0x0B). The entering
 * player then resumes exactly where a lone player would after that death:
 * same stage (+0x12), checkpoint (+0x21), loop, weapon (+0x13) and enemy rank
 * (+0x01). It reads and writes only RAM, at no CPU cost, so a cooperative
 * session replays like any other (scripts/gng_coop_check.mjs). */
const TURN_SWAP=0x77ec,PLAYER=0x60,WAITING=0x440,PLAYER_BYTES=0x30;
const PERSONAL=i=>i===0||i>=0x02&&i<=0x0b;
export const SHARED_PROGRESS=Object.freeze(
  Array.from({length:PLAYER_BYTES},(_,i)=>i).filter(i=>!PERSONAL(i)));
export function withSharedProgress(blocks){
  const key=blockKey(blocks,TURN_SWAP),swap=blocks.get(key);
  if(typeof swap!=='function')throw Error('GNG_TURN_SWAP_BLOCK_MISSING');
  const shared=new Map(blocks);
  shared.set(key,$=>{
    if($.PC===TURN_SWAP)for(const i of SHARED_PROGRESS)$.w(WAITING+i,$.rd(PLAYER+i),0);
    return swap($);
  });
  return shared;
}

/** Apply each recorded recovery at the first IRQ after its saved frame.
 * Replaying from reset takes the same path as resuming from that frame. */
function withRecoveryArmor(blocks,frames){
  const IRQ_ENTRY=0x65c4;
  const key=blockKey(blocks,IRQ_ENTRY),irq=blocks.get(key);
  if(typeof irq!=='function')throw Error('GNG_ARMOR_IRQ_BLOCK_MISSING');
  const recovered=new Map(blocks),pending=new Set(frames);
  recovered.set(key,$=>{
    if($.PC===IRQ_ENTRY&&pending.delete($.frame)&&$.rd(RAM.armor)===1){
      $.w(RAM.armor,0,0);
      // The ROM's armor pickup (0xE7A6) also restarts the current animation
      // with the armored equivalent for the two poses in its lookup table.
      const animation=0x510,pose=$.rd(animation+0x0e);
      const word=at=>$.rd(at)*256+$.rd(at+1);
      if(pose===1||pose===2){
        const offset=(pose-1)*2,pickupTable=0x9a39;
        if(word(animation+3)===word(word(pickupTable+2)+offset)){
          const armored=word(word(pickupTable)+offset);
          for(const at of [animation,animation+3]){
            $.w(at,armored>>8,0);$.w(at+1,armored&255,0);
          }
          $.w(animation+2,0,0);
        }
      }
    }
    return irq($);
  });
  return recovered;
}

/** Charge deaths at the first IRQ after the checkpoint, including repeated
 * deaths before a new automatic copy exists. The active and waiting life
 * counters remain attached to their respective players. */
function withRecoveryLifeLosses(blocks,losses){
  const IRQ_ENTRY=0x65c4,key=blockKey(blocks,IRQ_ENTRY),irq=blocks.get(key);
  if(typeof irq!=='function')throw Error('GNG_LIVES_IRQ_BLOCK_MISSING');
  const recovered=new Map(blocks),pending=new Map();
  for(const [frame,player,count] of losses){
    if(!pending.has(frame))pending.set(frame,[]);
    pending.get(frame).push([player,count]);
  }
  recovered.set(key,$=>{
    if($.PC===IRQ_ENTRY){
      const entries=pending.get($.frame);
      if(entries){
        pending.delete($.frame);
        const active=($.rd(RAM.turn)&1)+1;
        for(const [player,count] of entries){
          const address=active===player?RAM.lives:RAM.waiting;
          $.w(address,Math.max(0,$.rd(address)-count),0);
        }
        if(entries.some(([player])=>player===active))
          trimLifeIcons($,$.rd(RAM.lives));
      }
    }
    return irq($);
  });
  return recovered;
}

/** The ROM draws reserve lives (total minus the active life) at 0x2380,
 * using four character tiles per face; see bank 3, 0x5142–0x5173. Recovery
 * imports that old tilemap without running the ROM's respawn screen.
 * Remove only obsolete faces, preserving other HUD content and saves from
 * the opening animation, where these icons have not been drawn yet. */
function trimLifeIcons($,lives){
  for(let i=Math.max(0,lives-1);i<7;i++){
    const top=0x2380+i*2,bottom=top+32;
    if($.rd(top)!==0x8a||$.rd(top+1)!==0x8b||
       $.rd(bottom)!==0x9a||$.rd(bottom+1)!==0x9b)continue;
    for(const at of [top,top+1,bottom,bottom+1])$.w(at,0x20,0);
  }
}

/** New app games finish after the player's lives run out. At 0x77E7 the
 * ROM enters Game Over/Continue after the last death. Use its own expired
 * Continue cleanup (0x78EE): it passes to the other player if they still
 * have lives, otherwise returns to the title with the final scores.
 * Older saves omit `continues` and retain their original execution. */
export function withGameOptions(blocks,options){
  const o=gameOptions(options),pacedOnly=withEnemyPace(blocks,o.enemyPace);
  let paced=o.coop?withSharedProgress(pacedOnly):pacedOnly;
  if(o.recoveryArmorFrames)paced=withRecoveryArmor(paced,o.recoveryArmorFrames);
  if(o.recoveryLifeLosses)paced=withRecoveryLifeLosses(paced,o.recoveryLifeLosses);
  if(o.continues!==false)return paced;
  const key=blockKey(paced,0x77e7),end=paced.get(key);
  if(typeof end!=='function'||typeof paced.get(blockKey(paced,0x78ee))!=='function')
    throw Error('GNG_GAME_OVER_BLOCK_MISSING');
  const limited=new Map(paced);
  limited.set(key,$=>{
    if($.PC===0x77e7&&$.rd(0x02)===2&&$.rd(0x60)===0){
      $.PC=0x78ee;return;
    }
    return end($);
  });
  return limited;
}
