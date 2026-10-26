/** V3.B3: input tapes for the first *playable* route of the real AOT CPU.
 * Only hardware port transitions are scheduled; no RAM, sprite or frame
 * is injected. Each tape is grounded in an observed session or a visible
 * screen state of the original program (see docs/v3-b3-*.md).
 */
import {createHash} from 'node:crypto';
import {defineInputSchedule,readScheduledPort} from './gngb_input_contract.mjs';
import {CYCLES_PER_FRAME} from './gngb_runtime.mjs';
export const B3_TAPE_SCHEMA='gng.v3.b3.playable.v1';
const e=(frame,control,pressed)=>Object.freeze({
  cycle:frame*CYCLES_PER_FRAME,control,pressed
});
const tap=(frame,control,frames)=>[e(frame,control,true),
  e(frame+frames,control,false)];
// Operator sessions: Coin held from the paused first VBlank (311) for the
// 22 sampled frames, Start near 481 for 17 frames. B2-D halted here at
// bank 3 PC 0x519D frame 496 (reproduced exactly by this tape).
const humanEarlyCoin=Object.freeze([...tap(311,'coin1',22),
  ...tap(481,'start1',17)]);
// Coin while "PLEASE DEPOSIT COIN" is shown, Start on "PRESS START".
const titleCoinStart=Object.freeze([...tap(560,'coin1',12),
  ...tap(640,'start1',12)]);
// Arthur is on stage 1 from ~frame 1200 after titleCoinStart.
const arthurControls=Object.freeze([...titleCoinStart,
  ...tap(1240,'p1.right',60),...tap(1305,'p1.button1',4),
  ...tap(1330,'p1.button2',6),...tap(1380,'p1.left',40),
  ...tap(1430,'p1.down',20),...tap(1455,'p1.button1',3)]);

/** Deterministic "button masher" bot: 4-way joystick segments biased to
 * the right plus attack/jump taps, from `from` to `to`. Pure function of
 * its seed (LCG), so tape hashes are reproducible.
 */
export function botEvents(seed,from,to){
  let s=seed>>>0;
  const rnd=n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s%n;};
  const dirs=['p1.right','p1.right','p1.right','p1.left','p1.up','p1.down',null];
  const out=[];
  for(let f=from;f<to;){
    const len=8+rnd(50),dir=dirs[rnd(dirs.length)];
    const end=Math.min(f+len,to);
    if(dir)out.push(e(f,dir,true));
    for(let g=f+2;g+4<end;g+=6+rnd(20)){
      const button=rnd(3)===0?'p1.button2':'p1.button1';
      out.push(e(g,button,true),e(g+2+rnd(2),button,false));
    }
    if(dir)out.push(e(end,dir,false));
    f=end+1;
  }
  return out;
}
/** G2.3 sustained play: the same bot plus Coin and Start every `period`
 * frames. An open-loop bot reaches GAME OVER after ~1 min; these taps
 * let the game itself accept a CONTINUE or a new game instead of falling
 * back to attract. Mid-game Coin/Start are ordinary hardware inputs.
 */
export function sustainEvents(seed,from,to,period=900){
  const system=[];
  for(let f=from+period;f+100<to;f+=period)
    system.push(...tap(f,'coin1',12),...tap(f+80,'start1',12));
  return [...botEvents(seed,from,to),...system].sort((a,b)=>a.cycle-b.cycle);
}
const BOT_FRAMES=18000; // ~5 minutes at the board's ~59.64 Hz
const bot=seed=>Object.freeze([...titleCoinStart,
  ...botEvents(seed,1200,BOT_FRAMES-60)]);
const SUSTAIN_FRAMES=24000; // ~6.7 min: >= 5 min of play after the intro
const sustain=seed=>Object.freeze([...titleCoinStart,
  ...sustainEvents(seed,1200,SUSTAIN_FRAMES-60)]);
const tapes=Object.freeze({
  idle:Object.freeze([]),humanEarlyCoin,titleCoinStart,arthurControls,
  botA:bot(0xa11ce),botB:bot(0xb0b),botC:bot(0xc0ffee),
  // Generation 2 (G2.3): sustained play through continue/new game.
  sustainA:sustain(0x5a1a),sustainB:sustain(0x5b2b)
});
/** Profiles every selectable B3 generation must certify. */
export const B3_CORE_PROFILES=Object.freeze(
  ['idle','humanEarlyCoin','titleCoinStart','arthurControls']);
export const B3_HORIZONS=Object.freeze({
  idle:6000,humanEarlyCoin:6000,titleCoinStart:6000,arthurControls:6000,
  botA:BOT_FRAMES,botB:BOT_FRAMES,botC:BOT_FRAMES,
  sustainA:SUSTAIN_FRAMES,sustainB:SUSTAIN_FRAMES
});
export const B3_PROFILES=Object.freeze(Object.keys(tapes));
export function b3Tape(profile){
  if(!Object.hasOwn(tapes,profile))throw Error('V3_B3_PROFILE_INVALID');
  const schedule=defineInputSchedule(tapes[profile]);
  const metadata={schema:B3_TAPE_SCHEMA,profile,
    frames:B3_HORIZONS[profile],events:schedule.events};
  const sha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  return Object.freeze({...metadata,sha256,
    read:(addr,cycle)=>readScheduledPort(schedule,addr,cycle)});
}
