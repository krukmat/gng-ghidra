/** V2.B1: privacy-preserving coverage statistics from frozen JS runs only.
 * No oracle, no private bytes, no reexecution, no certification side effects.
 */
export const FRAME_BYTES=0x3800;
const REGIONS=[
  ['MAIN_RAM',0,0x1e00],
  ['SPRITE_RAM',0x1e00,0x2000],
  ['DMA_BUFFER',0x2000,0x2200],
  ['FG',0x2200,0x2a00],
  ['BG',0x2a00,0x3200],
  ['PALETTE',0x3200,0x3400],
  ['RGBA',0x3400,0x3800],
];
const fail=()=>{throw Error('V2_B1_COVERAGE_INPUT_INVALID');};
const firstZero=a=>{const i=a.findIndex(n=>n===0);return i<0?null:i+1;};
/** Receives result of verifySlot(), so all frame hashes/masks are verified. */
export function summarizeCoverage(slot,{required=594}={}){
  const {report,known,rows}=slot??{};
  const count=report?.frames;
  if(!Number.isInteger(count)||count<1||!Number.isInteger(required)||
     required<1||required>count||
     !Array.isArray(report.unknowns)||report.unknowns.length!==count||
     !Array.isArray(report.visible_unknowns)||report.visible_unknowns.length!==count||
     !Array.isArray(rows)||rows.length!==count||
     !(known instanceof Uint8Array)||known.length!==count*FRAME_BYTES)fail();
  const stateExact=report.unknowns.filter(n=>n===0).length;
  const rendererKnown=report.visible_unknowns.filter(n=>n===0).length;
  const dmaValid=rows.filter(r=>r.sprite_buffer_valid===true).length;
  const firstMissingAfterSix=rows.findIndex((r,i)=>i>=6&&
    (report.unknowns[i]!==0||report.visible_unknowns[i]!==0));
  const inspectFrame=firstMissingAfterSix>=0?firstMissingAfterSix+1:Math.min(count,7);
  const start=(inspectFrame-1)*FRAME_BYTES;
  const regions=Object.fromEntries(REGIONS.map(([name,a,b])=>{
    let unknown=0;
    for(let i=start+a;i<start+b;i++)
      if(known[i]!==255)unknown++;
    return [name,unknown];
  }));
  let cause='COVERAGE_COUNTS_OK';
  if(stateExact<required)cause='STATE_KNOWN_FRAMES_BELOW_GATE';
  else if(rendererKnown<required)cause=dmaValid<required
    ?'DMA_NOT_VALID_FOR_ENOUGH_FRAMES':'RENDERER_INPUTS_UNKNOWN';
  return {
    frames:count,required,state_exact:stateExact,renderer_known:rendererKnown,
    dma_valid:dmaValid,first_state_exact:firstZero(report.unknowns),
    first_renderer_known:firstZero(report.visible_unknowns),
    first_dma_valid:(rows.findIndex(r=>r.sprite_buffer_valid===true)+1)||null,
    first_unready_frame_after_six:firstMissingAfterSix<0?null:firstMissingAfterSix+1,
    inspected_frame:inspectFrame,inspected_unknowns_by_region:regions,
    inspected_sprite_buffer_valid:rows[inspectFrame-1].sprite_buffer_valid===true,
    cause
  };
}
