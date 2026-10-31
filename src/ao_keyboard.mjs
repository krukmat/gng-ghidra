/** Desktop keyboard for the common app: the same holds and pulses as touch
 * (ao_touch_controls.mjs) plus checkpoint and tape commands. Keys are the
 * ones of the retired desktop route: 5 Coin, 1 Start, arrows, Z attack,
 * X jump, G save, C load; T exports the tape.
 */
export const KEYS=Object.freeze({
  Digit5:{pulse:'coin1'},Digit1:{pulse:'start1'},
  ArrowUp:{hold:'p1.up'},ArrowDown:{hold:'p1.down'},
  ArrowLeft:{hold:'p1.left'},ArrowRight:{hold:'p1.right'},
  KeyZ:{hold:'p1.button1'},KeyX:{hold:'p1.button2'},
  KeyG:{command:'save'},KeyC:{command:'load'},KeyT:{command:'tape'}});

/** The action of a KeyboardEvent-like {code,ctrlKey,metaKey,altKey}, or null:
 * browser shortcuts with a modifier stay with the browser. */
export const keyAction=e=>e.ctrlKey||e.metaKey||e.altKey||
  !Object.hasOwn(KEYS,e.code)?null:KEYS[e.code];
