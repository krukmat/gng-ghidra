/**
 * T0 main-RAM write correlation contract. This module never accesses ROM, MAME
 * or native captures by itself. The caller MUST verify a full-oracle same-run
 * source manifest and postflight BEFORE passing authenticated rows/witness.
 * An ordered tap sequence is not an instruction-causal bus trace.
 */
const START=0x0000,END=0x1dff,LIMIT=65536;
const FAIL='A063_MAIN_RAM_';
const integer=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const reject=code=>{throw Error(FAIL+code);};
const decimal=s=>typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)?Number(s):NaN;
const same=(a,b)=>a.address===b.address&&a.data===b.data&&a.mask===b.mask;

/** Strict, bounded, fail-closed parser. Events remain in private process memory. */
export function parseMainRamWrites(tsv){
  if(typeof tsv!=='string')reject('OBSERVATIONS_REQUIRED');
  let enabled=0,count=null,truncated=null,resets=0,seen=0,ended=0;
  const epochs=[[],[]];
  for(const line of tsv.trimEnd().split('\n')){
    if(!line)continue;
    const [tag,...v]=line.split('\t');
    if(tag==='A063_MAIN_RAM_TAP_ENABLED'){
      if(v.length!==1||v[0]!=='1'||enabled++)reject('TAP_NOT_EXCLUSIVELY_ENABLED');
    }else if(tag==='RESET_NOTIFICATION'){
      resets++;
      if(resets>1)reject('EPOCH_COUNT_INVALID');
    }else if(tag==='A063_MAIN_RAM_WRITE'){
      if(v.length!==5)reject('WRITE_SHAPE_INVALID');
      const [epoch,ordinal,address,data,mask]=v.map(decimal);
      if(!integer(epoch,0,1)||epoch!==resets||
          !integer(ordinal,1,LIMIT)||ordinal!==++seen||
          !integer(address,START,END)||!integer(data,0,255)||
          !integer(mask,0,255))reject('WRITE_SEQUENCE_OR_RANGE_INVALID');
      epochs[epoch].push({address,data,mask});
    }else if(tag==='A063_MAIN_RAM_WRITE_COUNT'){
      if(v.length!==1||count!==null)reject('COUNT_DUPLICATE_OR_INVALID');
      count=decimal(v[0]);
    }else if(tag==='A063_MAIN_RAM_WRITE_TRUNCATED'){
      if(v.length!==1||truncated!==null||!['0','1'].includes(v[0]))
        reject('TRUNCATION_MARKER_INVALID');
      truncated=v[0]==='1';
    }else if(tag==='PROBE_END')ended++;
  }
  if(enabled!==1||resets!==1||ended!==1||count===null||
      !integer(count,0,LIMIT)||count!==seen||truncated!==false)
    reject('INCOMPLETE_TRUNCATED_OR_UNVERIFIED');
  return {epochs,total:count};
}

/**
 * Re-execute each banked static store from its authentic prestate.
 * No inferred bus traffic: word stores / other instruction families are
 * NOT assigned to STA/STB. Exactly one byte effect per indexed store.
 */
export function predictMainRamStores({rows,witness,compiled,compiledByBank}){
  if(!Array.isArray(rows)||rows.length<2||!Array.isArray(witness)||
      rows.length!==witness.length||!Array.isArray(compiled?.groups)||
      !(compiledByBank instanceof Map))reject('PRIVATE_COMPILED_INPUT_INVALID');
  const lookup=new Map(compiled.groups.map(g=>[g.bank+':'+g.pc,g]));
  if(lookup.size!==compiled.groups.length)reject('COMPILED_GROUP_DUPLICATE');
  const epochs=[[],[]];
  let lastEpoch=0,banked=0;
  for(let i=0;i<rows.length;i++){
    const r=rows[i],w=witness[i];
    if(r?.seq!==i||r?.pc!==r?.before?.PC||w?.seq!==i||w.pc!==r.pc||
        !integer(w.bank,0,4)||!integer(w.epoch,lastEpoch,lastEpoch+1)||
        w.epoch>1)reject('PRESTATE_WITNESS_SEQUENCE_INVALID');
    lastEpoch=w.epoch;
    if(r.pc<0x4000||r.pc>0x5fff)continue;
    banked++;
    const g=lookup.get(w.bank+':'+r.pc);
    if(!g||!g.spec)reject('UNCOMPILED_BANKED_INSTRUCTION');
    const spec=g.spec;
    if(!['STA_INDEXED','STB_INDEXED'].includes(spec.name))continue;
    if(spec.writesRamByte!==true||spec.writesSpriteWord!==false)
      reject('UNEXPECTED_STORE_COMPILER_CONTRACT');
    let writes=0,write=null;
    const sink=(address,data)=>{
      writes++;
      if(!integer(address,0,65535)||!integer(data,0,255)||writes>1)
        reject('PREDICTION_MALFORMED');
      write={address,data,mask:255};
    };
    try{
      const fn=compiledByBank.get(w.bank);
      if(typeof fn!=='function')reject('BANKED_RUNNER_MISSING');
      fn(Object.freeze({...r.before}),()=>reject('UNEXPECTED_WORD_STORE'),sink);
    }catch(err){
      if(String(err.message).startsWith(FAIL))throw err;
      reject('BANKED_RUNNER_FAILED');
    }
    if(writes!==1)reject('EXPECTED_SINGLE_BYTE_STORE');
    if(write.address<=END)epochs[w.epoch].push(write);
  }
  if(lastEpoch!==1||banked!==compiled.bankedSamples)
    reject('BANKED_COVERAGE_OR_EPOCH_INVALID');
  return {epochs,total:epochs[0].length+epochs[1].length};
}

/**
 * Unique ordered subsequence by epoch; never silently assign extras to
 * stack/other instructions, and never promote this to bus causality.
 */
export function compareMainRamWrites(predicted,native){
  if(!Array.isArray(predicted?.epochs)||predicted.epochs.length!==2||
      !Array.isArray(native?.epochs)||native.epochs.length!==2)
    reject('COMPARISON_INPUT_INVALID');
  let matched=0,extras=0,ambiguous=0,missing=0;
  const perEpoch=[];
  for(let epoch=0;epoch<2;epoch++){
    const p=predicted.epochs[epoch],n=native.epochs[epoch];
    if(!Array.isArray(p)||!Array.isArray(n)||
        [...p,...n].some(e=>!integer(e?.address,START,END)||
          !integer(e?.data,0,255)||e.mask!==255))
      reject('WRITE_VALUE_OR_MASK_INVALID');
    const first=[];let j=0;
    for(const event of p){
      while(j<n.length&&!same(n[j],event))j++;
      if(j===n.length){missing+=p.length-first.length;break;}
      first.push(j++);
    }
    const last=[];j=n.length-1;
    for(let k=p.length-1;k>=0&&first.length===p.length;k--){
      while(j>=0&&!same(n[j],p[k]))j--;
      if(j<0){missing++;break;}
      last[k]=j--;
    }
    if(first.length===p.length&&last.length===p.length){
      matched+=p.length;
      ambiguous+=first.filter((v,i)=>v!==last[i]).length;
      extras+=n.length-p.length;
    }
    perEpoch.push({epoch,predicted:p.length,native:n.length,
      ordered_match:first.length===p.length&&last.length===p.length});
  }
  const status=missing?'BLOCKED_NATIVE_WRITE_MISSING_OR_ORDER_CHANGED':
    ambiguous?'INCONCLUSIVE_NON_UNIQUE_ORDERED_MATCH':
    extras?'INCONCLUSIVE_UNATTRIBUTED_MAIN_RAM_WRITES':
    'ORDERED_EXACT_MATCH_ONLY_NOT_INSTRUCTION_CAUSAL';
  return {schema:'gng.a063.main-ram-write-t0.v1',status,
    predicted_main_ram_writes:predicted.total,
    native_main_ram_writes:native.total,
    ordered_matched_predictions:matched,missing_predictions:missing,
    ambiguous_predictions:ambiguous,unattributed_native_writes:extras,
    epochs:perEpoch,instruction_causal_link_proven:false,
    native_main_ram_stores_certified:false,
    full_game_equivalence_proven:false};
}

/** Require full-oracle same-run evidence before invoking prediction. */
export function requireSameRunEnvelope({manifest,fullOracle,postflight,rolesVerified}){
  if(manifest?.schema!=='gng.a06.private-bank-evidence-manifest.v1'||
      manifest.full_oracle_same_run_postflight_verified!==true||
      fullOracle?.status!=='A063_FULL_NATIVE_BANK_PROVENANCE_PASS'||
      fullOracle.native_bank_per_instruction_full_run_proven!==true||
      postflight!=='A063_POSTFLIGHT_CHAIN_INTACT_NOT_BANK_PROVENANCE'||
      rolesVerified!==11||Object.keys(manifest.sha256??{}).length!==11)
    reject('SAME_RUN_FULL_ORACLE_ATTESTATION_REQUIRED');
  return true;
}

/** Offline entry point: authenticate the SAME run (11 hashes + postflight).
 * No MAME invocation. No private value, PC, trace, or path is printed.
 */
export async function runOfflineMainRamGate({mameBin}){
  if(typeof mameBin!=='string'||!mameBin.includes('/'))
    reject('EXPLICIT_MAME_BINARY_REQUIRED');
  const [{readFile,lstat},{createHash},{spawnSync},{resolve},
    {compileNativeBankedPairs,validateFullOracleEvidence,validateFullOraclePaths},
    {emitStaticModule}]=await Promise.all([
      import('node:fs/promises'),import('node:crypto'),
      import('node:child_process'),import('node:path'),
      import('./r3_banked_static_gate.mjs'),import('./r3_static_trace_probe.mjs')]);
  const locations={flat:'out/gngb-flat.bin',
    banks:'out/r3/banked-rom/private-banked-rom.bin',
    trace:'out/r2/mame-probe/pre-instruction.jsonl',
    rawtrace:'out/r2/mame-probe/cpu.trace',
    observations:'out/r2/mame-probe/observations.tsv',
    capabilities:'out/r2/mame-probe/capabilities.json',
    preflight:'out/r3/banked-provenance/private-a063-preflight.json',
    postflight:'out/r2/mame-probe/private-a063-postflight.json',
    witness:'out/r3/banked-provenance/private-bank-per-prestate.jsonl',
    bank_report:'out/r3/banked-provenance/report.json',
    full_oracle:'out/r2/mame-probe/private-a063-full-oracle-check.json'};
  const manifestPath='out/r3/banked-provenance/private-source-manifest.json';
  validateFullOraclePaths(locations,manifestPath);
  async function readPlain(path){
    const parts=path.split('/');
    for(let i=1;i<=parts.length;i++){
      const info=await lstat(parts.slice(0,i).join('/'));
      if(i===parts.length?!info.isFile():!info.isDirectory())
        reject('REGULAR_EVIDENCE_FILE_REQUIRED');
    }
    return readFile(path);
  }
  const manifest=JSON.parse(await readPlain(manifestPath));
  const buffers={};
  for(const [role,path] of Object.entries(locations)){
    const expected=manifest.sha256?.[role];
    if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))
      reject('HASHED_SAME_RUN_ROLE_REQUIRED');
    const buffer=await readPlain(path);
    if(createHash('sha256').update(buffer).digest('hex')!==expected)
      reject('SAME_RUN_ROLE_HASH_MISMATCH');
    buffers[role]=buffer;
  }
  const chain=spawnSync('python3',['scripts/a063_capture_integrity.py','--verify',
    '--output',resolve('out/r2/mame-probe'),'--preflight',locations.preflight,
    '--mame-bin',mameBin],{encoding:'utf8',timeout:30000,
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(chain.status!==0||
      !chain.stdout.includes('A063_R1_POSTFLIGHT=A063_POSTFLIGHT_CHAIN_INTACT_NOT_BANK_PROVENANCE'))
    reject('POSTFLIGHT_CHAIN_INVALID');
  const rows=buffers.trace.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  const witness=buffers.witness.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  const report=JSON.parse(buffers.bank_report);
  const oracle=JSON.parse(buffers.full_oracle);
  validateFullOracleEvidence({report,oracle,rows,witness});
  requireSameRunEnvelope({manifest,fullOracle:oracle,
    postflight:'A063_POSTFLIGHT_CHAIN_INTACT_NOT_BANK_PROVENANCE',rolesVerified:11});
  const compiled=compileNativeBankedPairs({fixed:new Uint8Array(buffers.flat),
    packed:new Uint8Array(buffers.banks),rows,witness,nativeBankReport:report});
  const compiledByBank=new Map();
  for(const [bank,specs] of compiled.byBank){
    const uri='data:text/javascript;base64,'+
      Buffer.from(emitStaticModule(specs)).toString('base64');
    const {compiledStep}=await import(uri);
    compiledByBank.set(bank,compiledStep);
  }
  const predicted=predictMainRamStores({rows,witness,compiled,compiledByBank});
  const native=parseMainRamWrites(buffers.observations.toString('utf8'));
  return compareMainRamWrites(predicted,native);
}

if(process.argv[1]?.endsWith('/r3_native_main_ram_write_gate.mjs')){
  const a=process.argv.slice(2);
  if(a.length!==2||a[0]!=='--mame-bin'){
    console.error('A063_MAIN_RAM=BLOCKED explicit_binary_argument_required');
    process.exitCode=2;
  }else{
    runOfflineMainRamGate({mameBin:a[1]}).then(report=>{
      console.log(JSON.stringify(report));
      if(report.status!=='ORDERED_EXACT_MATCH_ONLY_NOT_INSTRUCTION_CAUSAL')
        process.exitCode=2;
    }).catch(()=>{
      console.error('A063_MAIN_RAM=BLOCKED evidence_or_contract_invalid');
      process.exitCode=2;
    });
  }
}
