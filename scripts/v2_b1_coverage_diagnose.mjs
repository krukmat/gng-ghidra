#!/usr/bin/env node
/** Read-only diagnosis after an unsuccessful V2.B1 T5 coverage gate.
 * Never opens MAME, ROM, or PNG files; never publishes private data.
 */
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySlot,compareSlots} from '../src/v2_b1_gate_lib.mjs';
import {summarizeCoverage} from '../src/v2_b1_coverage.mjs';
const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
try{
  if(process.argv.length!==2)throw Error('V2_B1_INVALID_ARGS');
  const out=join(ROOT,'out/v2/b1');
  const one=verifySlot(out,'one'),two=verifySlot(out,'two');
  compareSlots(one,two);
  const x=summarizeCoverage(one);
  console.log('V2_B1_DIAG=PASS_READ_ONLY_NO_ORACLE');
  console.log('V2_B1_DIAG_CAUSE='+x.cause);
  console.log('V2_B1_DIAG_FRAMES='+x.frames);
  console.log('V2_B1_DIAG_STATE_EXACT='+x.state_exact);
  console.log('V2_B1_DIAG_RENDERER_KNOWN='+x.renderer_known);
  console.log('V2_B1_DIAG_DMA_VALID='+x.dma_valid);
  console.log('V2_B1_DIAG_FIRST_STATE_EXACT='+String(x.first_state_exact??'NONE'));
  console.log('V2_B1_DIAG_FIRST_RENDERER_KNOWN='+String(x.first_renderer_known??'NONE'));
  console.log('V2_B1_DIAG_FIRST_DMA='+String(x.first_dma_valid??'NONE'));
  console.log('V2_B1_DIAG_FIRST_UNREADY_AFTER_6='+String(x.first_unready_frame_after_six??'NONE'));
  console.log('V2_B1_DIAG_INSPECTED_FRAME='+x.inspected_frame);
  console.log('V2_B1_DIAG_INSPECTED_SPRITE_BUFFER_VALID='+(x.inspected_sprite_buffer_valid?'YES':'NO'));
  for(const [region,n] of Object.entries(x.inspected_unknowns_by_region))
    console.log('V2_B1_DIAG_UNKNOWN_'+region+'='+n);
}catch(e){
  console.log('V2_B1_DIAG=BLOCKED_PRIVATE_INPUT_OR_INTEGRITY');
  process.exitCode=2;
}
