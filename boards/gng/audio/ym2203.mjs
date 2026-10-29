/** GnG sound board: two YM2203 at 1.5 MHz on the 12 MHz master clock,
 * decoded at 0xe000-0xe003 (chip = bit 1, register port = bit 0) and mixed
 * with MAME gng.cpp route gains: FM, SSG 1/2 = 0.4; SSG 3 = 0.2. The 'R'
 * reset line resets both chips. The synthesis is the base YM2203 bank.
 */
import {loadYm2203Bank,validateYm2203Config}
  from '../../../base/src/devices/ym2203/wasm.mjs';

export const GNG_YM2203=Object.freeze({chips:2,tickHz:12000000,chipHz:1500000,
  gains:Object.freeze([0.4,0.4,0.4,0.2]),maxBlockSamples:12500});
export const GNG_YM2203_SAMPLE_RATE=validateYm2203Config(GNG_YM2203).sampleRate;
const PORT_BASE=0xe000;

// Same write/reset/render/save/load calls as the sound commands expect. The
// address converts to int32 like the reference's i32 parameter; outside the
// decoded range it becomes an invalid chip and stops.
export async function createGngYm(wasm){
  const bank=(await loadYm2203Bank(wasm)).create(GNG_YM2203);
  return Object.freeze({
    sampleRate:bank.sampleRate,
    write(tick,addr,value){
      const offset=(addr|0)-PORT_BASE;
      bank.write(tick,offset>>1,offset&1,value);
    },
    reset:bank.reset,render:bank.render,save:bank.save,load:bank.load,
    destroy:bank.destroy,
  });
}
