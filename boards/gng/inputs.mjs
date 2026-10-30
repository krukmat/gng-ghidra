/** GnG board input ports (MAME 0.289 gng.cpp): addresses and active-low bits.
 * DIP defaults and joystick policy belong to the game (games/gngb/inputs.mjs).
 */
export const INPUT_PORTS=Object.freeze({
  SYSTEM:0x3000,P1:0x3001,P2:0x3002,DSW1:0x3003,DSW2:0x3004,
});
/** Idle bytes of SYSTEM, P1 and P2: every control released. */
export const IDLE_BYTES=Object.freeze([0xff,0xff,0xff]);
const CONTROL_SPECS=Object.freeze({
  start1:['SYSTEM',0x01],start2:['SYSTEM',0x02],
  service1:['SYSTEM',0x20],coin1:['SYSTEM',0x40],coin2:['SYSTEM',0x80],
  'p1.right':['P1',0x01],'p1.left':['P1',0x02],
  'p1.down':['P1',0x04],'p1.up':['P1',0x08],
  'p1.button1':['P1',0x10],'p1.button2':['P1',0x20],
  'p2.right':['P2',0x01],'p2.left':['P2',0x02],
  'p2.down':['P2',0x04],'p2.up':['P2',0x08],
  'p2.button1':['P2',0x10],'p2.button2':['P2',0x20],
});
export const INPUT_CONTROLS=Object.freeze(
  Object.fromEntries(Object.entries(CONTROL_SPECS).map(([name,[port,bit]])=>
    [name,Object.freeze({port,bit,activeLow:true})]))
);
