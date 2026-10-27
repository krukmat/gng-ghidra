/**
 * G5-FAST B1 safe report: no ROM bytes, opcode bytes, immediates, decoded
 * JS source, stack/register values, absolute local paths, or MAME snapshots.
 * PC addresses are diagnostic metadata (not proof of runtime reachability).
 */
const IDENTIFIER=/^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_FRONTIERS=256;
const reasonSet=new Set([
  'UNSUPPORTED_Z80_OPCODE','UNSUPPORTED_Z80_ED_INSTRUCTION',
  'OUTSIDE_SOUND_ROM'
]);
function cleanTag(value) {
  if(typeof value!=='string'||!IDENTIFIER.test(value))
    throw Error('AUDIO_REPORT_UNSAFE_TAG');
  return value;
}
function cleanPC(pc) {
  if(!Number.isInteger(pc)||pc<0||pc>65535)
    throw Error('AUDIO_REPORT_UNSAFE_PC');
  return pc;
}
function familyOf(blocker) {
  return blocker.family ? cleanTag(blocker.family) : 'OUTSIDE_SOUND_ROM';
}
function safeFrontier(blocker) {
  if(!reasonSet.has(blocker?.reason))
    throw Error('AUDIO_REPORT_INVALID_REASON');
  const item={pc:cleanPC(blocker.pc),family:familyOf(blocker),
    reason:blocker.reason};
  if(blocker.ed_instruction!==undefined) {
    if(item.family!=='ED_EXTENDED_PREFIX')
      throw Error('AUDIO_REPORT_ED_FAMILY_MISMATCH');
    item.ed_instruction=cleanTag(blocker.ed_instruction);
  }
  if(blocker.indexed_instruction!==undefined) {
    if(!['DD_IX_PREFIX','FD_IY_PREFIX'].includes(item.family))
      throw Error('AUDIO_REPORT_INDEX_FAMILY_MISMATCH');
    item.indexed_instruction=cleanTag(blocker.indexed_instruction);
  }
  if(blocker.cb_instruction!==undefined) {
    if(item.family!=='CB_BIT_ROTATE_PREFIX')
      throw Error('AUDIO_REPORT_CB_FAMILY_MISMATCH');
    item.cb_instruction=cleanTag(blocker.cb_instruction);
  }
  return item;
}

/** Priority counts STATIC FRONTIERS, not dynamic trace frequency.
 * All blocked families remain P0 for reachability certification.
 */
export function summarizeZ80Frontiers(result,{
  seedSource='RESET_VECTOR_ONLY', limit=4096, maxFrontiers=MAX_FRONTIERS
}={}) {
  if(!result||!Array.isArray(result.blockers)||
     !Array.isArray(result.entrypoints)||!Array.isArray(result.visitedPcs)||
     !Number.isInteger(result.compiled)||result.compiled<0||
     result.compiled!==result.visitedPcs.length||
     !Number.isInteger(result.pending)||result.pending<0||
     typeof result.truncated!=='boolean'||
     !Number.isInteger(limit)||limit<1||limit>16384||
     !Number.isInteger(maxFrontiers)||maxFrontiers<1||maxFrontiers>MAX_FRONTIERS)
    throw Error('AUDIO_REPORT_INVALID_SCAN');
  if(!['RESET_VECTOR_ONLY','OPERATOR_SUPPLIED_PCS'].includes(seedSource))
    throw Error('AUDIO_REPORT_INVALID_SOURCE');
  const seen=new Set(),frontiers=[];
  for(const blocker of result.blockers) {
    const item=safeFrontier(blocker);
    if(seen.has(item.pc))continue;
    seen.add(item.pc);
    frontiers.push(item);
  }
  frontiers.sort((a,b)=>a.pc-b.pc);
  const families=new Map();
  for(const item of frontiers) {
    const f=families.get(item.family)||{family:item.family,
      blocked_static_pcs:0,first_pc:item.pc,priority:'P0'};
    f.blocked_static_pcs++;
    f.first_pc=Math.min(f.first_pc,item.pc);
    families.set(item.family,f);
  }
  const ranked=[...families.values()].sort((a,b)=>
    b.blocked_static_pcs-a.blocked_static_pcs||
    a.first_pc-b.first_pc||a.family.localeCompare(b.family));
  const roots=result.entrypoints.map(cleanPC);
  const reached=result.visitedPcs.map(cleanPC);
  const cap=result.truncated||result.pending>0;
  return Object.freeze({
    kind:'GNG_AUDIO_Z80_FRONTIER_SCAN_V1',
    status:cap?'TRUNCATED':frontiers.length?'PARTIAL_UNCERTIFIED':'NO_STATIC_BLOCKER_NOT_CERTIFIED',
    rom_identity:'SHA1_MATCH',
    seed_source:seedSource,
    operator_seed_count:roots.length,
    operator_seed_pcs:roots,
    // Reachability is a static over-approximation, not executed PCs.
    static_decoded_pcs:result.compiled,
    static_frontiers_total:frontiers.length,
    static_frontiers_reported:Math.min(frontiers.length,maxFrontiers),
    static_frontiers_omitted:Math.max(0,frontiers.length-maxFrontiers),
    pending_static_edges:result.pending,
    scan_limit:limit,
    truncated:cap,
    families:ranked,
    frontiers:frontiers.slice(0,maxFrontiers),
    // Explicitly no fraction-of-ROM or playable percentage from static CFG.
    executed_pc_coverage_verified:false,
    native_trace_parity_verified:false,
    z80_timing_parity_verified:false,
    ym_pcm_verified:false,
    gameplay_audio_verified:false,
    private_rom_bytes_exported:false,
    static_generated_code_exported:false
  });
}


export function parseZ80OperatorSeeds(json){
  let obj;
  try{obj=JSON.parse(json)}catch{throw Error('AUDIO_SCAN_ROOTS_INVALID')}
  if(!obj||obj.kind!=='GNG_AUDIO_Z80_OPERATOR_PCS_V1'||
    obj.rom_sha1!=='7ef9ec5c2072e21c787a6bbf700033f50c759c1d'||
    !Array.isArray(obj.pcs)||obj.pcs.length<1||obj.pcs.length>64||
    obj.pcs.some(pc=>!Number.isInteger(pc)||pc<0||pc>=32768))
    throw Error('AUDIO_SCAN_ROOTS_INVALID');
  return [...new Set([0,...obj.pcs])];
}
