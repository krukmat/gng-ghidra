/**
 * Additive, aggregate-only diagnostic for a verified compileNativeBankedPairs
 * result. Generated stores are collected in a prediction sink, never applied
 * to board memory and never promoted to native bus evidence. No I/O or CLI.
 */
import {checkedState,diffRegisters} from './r3_static_trace_probe.mjs';

const BANK_START=0x4000,BANK_END=0x5fff,BANK_COUNT=5;
const UNSUPPORTED='UNSUPPORTED_BANKED_OPCODE';
const PREFIX='A064_EFFECT_PROFILE_';
const reject=code=>{throw Error(PREFIX+code);};
const whole=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>
  Number.isSafeInteger(n)&&n>=min&&n<=max;
const branches=['BRA','BRN','BHI','BLS','BCC','BCS','BNE','BEQ',
  'BVC','BVS','BPL','BMI','BGE','BLT','BGT','BLE'];
const unary=['NEG','COM','LSR','ROR','ASR','ASL','ROL','DEC','INC','TST','CLR'];
export const EFFECT_PROFILE_FAMILIES=Object.freeze([
  'NOP','ORCC_IMM','ANDCC_IMM','LDA_IMM','LDB_IMM','LDX_IMM','LDU_IMM',
  'LDD_IMM','LDY_IMM','LDS_IMM','STD_X_POSTINC','LEAY_MINUS_1',
  'STA_INDEXED','STB_INDEXED','CMPX_IMM',...branches,'LBRA','JMP_EXT',
  ...unary.flatMap(name=>[name+'_A',name+'_B']),UNSUPPORTED
]);
const families=new Set(EFFECT_PROFILE_FAMILIES);
export const EFFECT_PROFILE_REGIONS=Object.freeze([
  'MAIN_RAM','SPRITE_RAM','FG_RAM','BG_RAM','INPUT_OR_MMIO',
  'PALETTE_MMIO','SCROLL_MMIO','SPRITE_DMA','BANK_SELECT_MMIO',
  'OTHER_MMIO','BANKED_ROM','FIXED_ROM'
]);
function region(addr){
  // Same coarse RAM/video boundaries as gngb_board_memory/video_memory;
  // control addresses follow gng_main_map. A region is not writable proof.
  if(addr<0x1e00)return 'MAIN_RAM';
  if(addr<0x2000)return 'SPRITE_RAM';
  if(addr<0x2800)return 'FG_RAM';
  if(addr<0x3000)return 'BG_RAM';
  if(addr<0x3800)return 'INPUT_OR_MMIO';
  if(addr<0x3a00)return 'PALETTE_MMIO';
  if(addr>=0x3b08&&addr<=0x3b0b)return 'SCROLL_MMIO';
  if(addr===0x3c00)return 'SPRITE_DMA';
  if(addr===0x3e00)return 'BANK_SELECT_MMIO';
  if(addr<0x4000)return 'OTHER_MMIO';
  if(addr<0x6000)return 'BANKED_ROM';
  return 'FIXED_ROM';
}
const regionCounts=()=>Object.fromEntries(EFFECT_PROFILE_REGIONS.map(name=>[name,0]));
function counters(){
  return {
    native_samples:0,executed_samples:0,matched_register_checkpoints:0,
    differing_register_checkpoints:0,missing_next_native_checkpoint:0,
    cross_reset_checkpoint_boundaries:0,predicted_write_instructions:0,
    predicted_byte_writes:0,predicted_word_write_calls:0,
    predicted_byte_writes_by_region:regionCounts()
  };
}
function validateInputs({rows,witness,compiled,compiledByBank}){
  if(!Array.isArray(rows)||rows.length<1||!Array.isArray(witness)||
      witness.length!==rows.length||!Array.isArray(compiled?.groups)||
      !(compiled.counts instanceof Map)||!(compiled.byBank instanceof Map)||
      !(compiledByBank instanceof Map)||!whole(compiled.bankedSamples,1))
    reject('INVALID_INPUT');
  const actualCounts=new Map();
  let epoch=0,banked=0;
  for(let i=0;i<rows.length;i++){
    const row=rows[i],mark=witness[i];
    if(row?.schema!=='gng.r2.pre-instruction.v1'||
        row.kind!=='pre_instruction'||row.origin!=='mame-native-tracelog'||
        row.seq!==i||!whole(row.pc,0,65535)||row.before?.PC!==row.pc||
        mark?.seq!==i||mark.pc!==row.pc||!whole(mark.bank,0,BANK_COUNT-1)||
        !whole(mark.epoch,0)||mark.epoch<epoch||mark.epoch>epoch+1||
        (i===0&&mark.epoch!==0))reject('INVALID_NATIVE_WITNESS');
    try{checkedState(row.before);}catch{reject('INVALID_REGISTER_STATE');}
    epoch=mark.epoch;
    if(row.pc<BANK_START||row.pc>BANK_END)continue;
    banked++;
    const key=mark.bank+':'+row.pc;
    actualCounts.set(key,(actualCounts.get(key)??0)+1);
  }
  if(banked!==compiled.bankedSamples||actualCounts.size!==compiled.groups.length||
      compiled.counts.size!==actualCounts.size)reject('COVERAGE_MISMATCH');
  const pairs=new Map(),byBank=new Map();
  for(const group of compiled.groups){
    if(!whole(group?.bank,0,BANK_COUNT-1)||
        !whole(group.pc,BANK_START,BANK_END)||
        group.source!=='AUTHENTIC_BANKED_ROM_IMAGE')reject('INVALID_COMPILED_GROUP');
    const key=group.bank+':'+group.pc,n=compiled.counts.get(key);
    if(pairs.has(key)||!whole(n,1)||actualCounts.get(key)!==n)
      reject('COVERAGE_MISMATCH');
    const spec=group.spec;
    if(spec===null){
      if(group.classification!==UNSUPPORTED)reject('INVALID_COMPILED_GROUP');
    }else{
      if(!spec||spec.pc!==group.pc||!whole(spec.len,1,4)||
          !whole(spec.next,0,65535)||spec.next!==((group.pc+spec.len)&65535)||
          group.pc+spec.len>0x6000||typeof spec.statement!=='string'||
          !families.has(spec.name)||spec.name===UNSUPPORTED||
          group.classification!==spec.name||
          typeof spec.writesRamByte!=='boolean'||
          typeof spec.writesSpriteWord!=='boolean'||
          spec.writesRamByte!==['STA_INDEXED','STB_INDEXED'].includes(spec.name)||
          spec.writesSpriteWord!==(spec.name==='STD_X_POSTINC'))
        reject('INVALID_COMPILED_SPEC');
      const specs=byBank.get(group.bank)??[];
      specs.push(spec);byBank.set(group.bank,specs);
    }
    pairs.set(key,group);
  }
  if(compiled.byBank.size!==byBank.size||compiledByBank.size!==byBank.size)
    reject('RUNNER_COVERAGE_MISMATCH');
  for(const [bank,specs] of byBank){
    const declared=compiled.byBank.get(bank);
    if(!Array.isArray(declared)||declared.length!==specs.length||
        new Set(declared).size!==declared.length||
        specs.some(spec=>!declared.includes(spec))||
        typeof compiledByBank.get(bank)!=='function')
      reject('RUNNER_COVERAGE_MISMATCH');
  }
  return {pairs,epochs:epoch+1};
}

/**
 * Inputs stay private. Callers must independently verify provenance and the
 * generated runners; this function rechecks structure and exact coverage.
 * All supported steps execute, including stores and steps lacking a following
 * checkpoint. Register comparison stops at each explicit reset boundary.
 */
export function profileNativeBankedEffects(input){
  const {pairs,epochs}=validateInputs(input??{});
  const {rows,witness,compiled,compiledByBank}=input;
  const total=counters(),byFamily=new Map();
  let unsupported=0,effectfulCompared=0;
  for(let i=0;i<rows.length;i++){
    const row=rows[i],mark=witness[i];
    if(row.pc<BANK_START||row.pc>BANK_END)continue;
    const group=pairs.get(mark.bank+':'+row.pc),name=group.classification;
    let family=byFamily.get(name);
    if(!family){family=counters();byFamily.set(name,family);}
    total.native_samples++;family.native_samples++;
    if(group.spec===null){unsupported++;continue;}
    const spec=group.spec,regions=[];
    let byteCalls=0,wordCalls=0,result,invalidEffect=false;
    // Never retain values or addresses in a returned object or error.
    const byteSink=(...args)=>{
      if(!spec.writesRamByte||args.length!==2||byteCalls||wordCalls||
          !whole(args[0],0,65535)||!whole(args[1],0,255)){
        invalidEffect=true;reject('INVALID_BYTE_EFFECT');
      }
      byteCalls++;regions.push(region(args[0]));
    };
    const wordSink=(...args)=>{
      if(!spec.writesSpriteWord||args.length!==2||wordCalls||byteCalls||
          !whole(args[0],0x1e00,0x1ffe)||!whole(args[1],0,65535)){
        invalidEffect=true;reject('INVALID_WORD_EFFECT');
      }
      wordCalls++;regions.push(region(args[0]),region(args[0]+1));
    };
    try{
      result=compiledByBank.get(mark.bank)(Object.freeze({...row.before}),wordSink,byteSink);
      checkedState(result);
    }catch{reject('RUNNER_FAILED');}
    if(invalidEffect)reject('RUNNER_EFFECT_INVALID');
    if(byteCalls!==(spec.writesRamByte?1:0)||wordCalls!==(spec.writesSpriteWord?1:0))
      reject('RUNNER_EFFECT_COUNT_MISMATCH');
    for(const count of [total,family]){
      count.executed_samples++;
      if(regions.length)count.predicted_write_instructions++;
      count.predicted_byte_writes+=regions.length;
      count.predicted_word_write_calls+=wordCalls;
      for(const name of regions)count.predicted_byte_writes_by_region[name]++;
    }
    let field;
    if(i+1===rows.length)field='missing_next_native_checkpoint';
    else if(mark.epoch!==witness[i+1].epoch)field='cross_reset_checkpoint_boundaries';
    else{
      field=diffRegisters(result,rows[i+1].before).length?
        'differing_register_checkpoints':'matched_register_checkpoints';
      if(regions.length)effectfulCompared++;
    }
    total[field]++;family[field]++;
  }
  if(total.native_samples!==compiled.bankedSamples||
      total.executed_samples+unsupported!==total.native_samples||
      total.matched_register_checkpoints+total.differing_register_checkpoints+
        total.missing_next_native_checkpoint+total.cross_reset_checkpoint_boundaries!==
        total.executed_samples||
      Object.values(total.predicted_byte_writes_by_region).reduce((a,b)=>a+b,0)!==
        total.predicted_byte_writes)reject('RESULT_PARTITION_MISMATCH');
  return {
    schema:'gng.a064.banked-effect-profile.v1',
    status:total.differing_register_checkpoints?
      'BANKED_EFFECT_PROFILE_REGISTER_DIVERGENCE':
      'BANKED_EFFECT_PROFILE_PREDICTED_WRITES_ONLY',
    native_preinstruction_samples:rows.length,
    native_bank_window_samples:total.native_samples,
    native_bank_pc_pair_count:compiled.groups.length,
    explicit_epoch_count:epochs,
    native_samples_with_static_codegen:total.executed_samples,
    native_samples_without_static_codegen:unsupported,
    matched_register_checkpoints:total.matched_register_checkpoints,
    differing_register_checkpoints:total.differing_register_checkpoints,
    missing_next_native_checkpoint:total.missing_next_native_checkpoint,
    cross_reset_checkpoint_boundaries:total.cross_reset_checkpoint_boundaries,
    effectful_register_checkpoints_compared:effectfulCompared,
    predicted_write_instructions:total.predicted_write_instructions,
    predicted_byte_writes:total.predicted_byte_writes,
    predicted_word_write_calls:total.predicted_word_write_calls,
    predicted_byte_writes_by_region:total.predicted_byte_writes_by_region,
    families:[...byFamily.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,count])=>({
      opcode_family:name,static_codegen_available:name!==UNSUPPORTED,...count
    })),
    exact_sample_partition_verified:true,
    all_supported_steps_executed:true,
    cpu_starts_each_individual_step_from_native_prestate:true,
    bank_provenance_verified_by_this_diagnostic:false,
    predicted_writes_native_verified:false,
    native_memory_bus_equivalence_verified:false,
    native_irq_sync_resume_verified:false,
    autonomous_runtime_or_first_frame_verified:false,
    private_cpu_or_rom_values_exported:false,
    game_playable:false
  };
}
