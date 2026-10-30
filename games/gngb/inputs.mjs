/** gngb input policy: DIP defaults, 4-way joysticks and the Continue combo.
 * Port addresses and bits come from the board (boards/gng/inputs.mjs).
 */
export const DIP_DEFAULTS=Object.freeze([0xdf,0xfb]); // DSW1, DSW2
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
