/** gngb input policy: DIP defaults, 4-way joysticks and the Continue combo.
 * Port addresses and bits come from the board (boards/gng/inputs.mjs).
 */
export const DIP_DEFAULTS=Object.freeze([0xdf,0xfb]); // DSW1, DSW2
/** DSW2 fields of the options menu (MAME 0.289 gng.cpp): lives 0x03 and
 * difficulty 0x60. The ROM copies ~DSW2 to RAM 0x41 every frame (0x6232);
 * difficulty picks the starting enemy rank (table 0x6228: easy 0, normal 6,
 * hard 24, hardest 32), which grows while a life lasts. Cabinet stays
 * upright (bit 0x04 clear): both players then play with the P1 controls.
 * Bonus life and DSW1 keep their defaults. */
export const LIVES=Object.freeze({3:0x03,4:0x02,5:0x01,7:0x00});
export const DIFFICULTIES=Object.freeze({easy:0x40,normal:0x60,hard:0x20,hardest:0x00});
export function dipSwitches({lives=3,difficulty='normal'}={}){
  if(!Object.hasOwn(LIVES,lives)||!Object.hasOwn(DIFFICULTIES,difficulty))
    throw Error('GNG_DIP_SETTING_INVALID');
  return [DIP_DEFAULTS[0],(DIP_DEFAULTS[1]&~0x63)|LIVES[lives]|DIFFICULTIES[difficulty]];
}
export const FOUR_WAY_PLAYERS=Object.freeze(['p1','p2']);
// Continuing on gngb requires Start and either action button together.
export const CONTINUE_CONTROLS=Object.freeze(['start1','p1.button1']);
const DIRECTIONS=['up','down','left','right'];

/** True when a 4-way player holds more than one direction. Conservative
 * frontend policy for MAME's PORT_4WAY: it rejects conflicting combinations
 * and makes no claim about the live joystick resolution. */
export function fourWayConflict(pressed){
  return FOUR_WAY_PLAYERS.some(player=>
    DIRECTIONS.filter(d=>pressed.has(player+'.'+d)).length>1);
}
