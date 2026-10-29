import {CONTRACT_VERSION} from '../contracts/index.mjs';

/** Implemented and testable surface, not a claim of complete MC6809 ISA. */
export const capabilities=Object.freeze({
  contract:CONTRACT_VERSION,
  cpu:{mc6809:Object.freeze({
    instructions:['abx','andcc','bra','brn','bsr','daa','lbsr','mul',
      'nop','orcc','rti','rts','sex','sync'],
    interrupts:['irq'],
    overlays:true,
    dynamicCode:false,
    stopOnUnsupported:true,
  }),z80:Object.freeze({
    instructions:[],
    interrupts:['irq'],
    overlays:false,
    dynamicCode:true,
    stopOnUnsupported:true,
  })},
});
