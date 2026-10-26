import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmod,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,symlink,writeFile}
  from 'node:fs/promises';
import {delimiter,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

// All input is constructed here. No native capture, ROM, Docker, or workspace
// out/ directory is read by these tests.
const cli=fileURLToPath(new URL('../scripts/r3_d6_followup_diagnostic.mjs',import.meta.url));
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
const blocked='D6_FOLLOWUP=BLOCKED evidence_or_contract_invalid\n';
const fakeSecret='SYNTHETIC_PRIVATE_DIAGNOSTIC_MUST_NOT_ESCAPE';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function save(root,path,bytes){
  await mkdir(dirname(join(root,path)),{recursive:true});
  await writeFile(join(root,path),bytes);
}
async function resign(root){
  const hashes={};
  for(const [role,path] of Object.entries(locations))
    hashes[role]=sha(await readFile(join(root,path)));
  await save(root,manifestPath,JSON.stringify({
    schema:'gng.a06.private-bank-evidence-manifest.v1',
    full_oracle_same_run_postflight_verified:true,sha256:hashes
  }));
}
async function evidenceSnapshot(root,path='out'){
  const entries={};
  for(const entry of (await readdir(join(root,path))).sort()){
    const relative=join(path,entry),absolute=join(root,relative);
    const stat=await lstat(absolute);
    if(stat.isDirectory()){
      entries[relative]={mode:stat.mode,mtime:stat.mtimeMs,kind:'DIRECTORY'};
      Object.assign(entries,await evidenceSnapshot(root,relative));
    }
    else entries[relative]={mode:stat.mode,size:stat.size,mtime:stat.mtimeMs,
      sha256:stat.isSymbolicLink()?'SYMLINK':sha(await readFile(absolute))};
  }
  return entries;
}
async function fixture(run){
  const root=await realpath(await mkdtemp(join(tmpdir(),'gng-d6-followup-cli-')));
  try{
    const flat=Buffer.alloc(65536),banks=Buffer.alloc(5*8192);
    // LDA immediate; NOP; unsupported RTI. These bytes are synthetic.
    banks.set([0x86,0x7b,0x12,0x3b]);
    const pcs=[0x4000,0x4002,0x4000,0x4002,0x4003];
    const rows=pcs.map((pc,seq)=>({schema:'gng.r2.pre-instruction.v1',
      origin:'mame-native-tracelog',kind:'pre_instruction',seq,pc,
      before:{PC:pc,A:seq===0?0xad:0x7b,B:0xa9,X:0x9876,Y:0x8765,
        U:0x7654,S:0x2000,DP:0xa8,CC:0x50}}));
    const witness=pcs.map((pc,seq)=>({seq,pc,bank:0,epoch:seq<2?0:1}));
    const full={native_bank_per_instruction_full_run_proven:true,
      rom_pair_vs_live_bank_comparisons:rows.length,rom_pair_vs_live_bank_mismatch_count:0,
      explicit_reset_epoch_count:2,all_epochs_compared_without_frame_inference:true,
      verified_post_selector_bank_transitions:1,native_prestate_count_by_epoch:{'0':2,'1':3}};
    const report={...full,status:'BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED',
      full_oracle_status:'A063_FULL_NATIVE_BANK_PROVENANCE_PASS',
      full_oracle_same_run_postflight_verified:true,
      native_preinstruction_samples:rows.length,bank_window_pc_samples:5,
      native_banked_prestate_bank_identified:5,distinct_observed_bank_pc_pairs:3,
      distinct_bank_window_pcs:3,observed_bank_counts:{'0':5,'1':0,'2':0,'3':0,'4':0},
      bank_pc_pairs:[{bank:0,pc:'0x4000',samples:2},
        {bank:0,pc:'0x4002',samples:2},{bank:0,pc:'0x4003',samples:1}],
      native_per_instruction_mapped_ROM_signature_verified:true};
    const bytes={flat,banks,trace:rows.map(JSON.stringify).join('\n')+'\n',
      rawtrace:'SYNTHETIC TRACE ONLY\n',observations:'SYNTHETIC OBSERVATIONS ONLY\n',
      capabilities:'{}',preflight:'{}',postflight:'{}',
      witness:witness.map(JSON.stringify).join('\n')+'\n',bank_report:JSON.stringify(report),
      full_oracle:JSON.stringify({...full,status:'A063_FULL_NATIVE_BANK_PROVENANCE_PASS'})};
    for(const [role,path] of Object.entries(locations))await save(root,path,bytes[role]);
    await resign(root);
    await mkdir(join(root,'fakebin'));
    const verifier=join(root,'fakebin/python3'),record=join(root,'verifier-argv.json');
    await writeFile(verifier,`#!${process.execPath}\n`+
      `const fs=require('node:fs');\n`+
      `fs.writeFileSync(process.env.D6_TEST_VERIFY_RECORD,JSON.stringify({args:process.argv.slice(2),noBytecode:process.env.PYTHONDONTWRITEBYTECODE}));\n`+
      `process.stdout.write(${JSON.stringify(fakeSecret+'\n')});\n`+
      `process.stderr.write(${JSON.stringify(fakeSecret+'\n')});\n`+
      `process.exit(Number(process.env.D6_TEST_VERIFY_STATUS||0));\n`);
    await chmod(verifier,0o755);
    const execute=(args=['--mame-bin','/synthetic-protected/mame'],extraEnv={})=>
      spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:15000,
        env:{...process.env,PATH:join(root,'fakebin')+delimiter+dirname(process.execPath),
          D6_TEST_VERIFY_RECORD:record,...extraEnv}});
    await run({root,record,execute});
  }finally{await rm(root,{recursive:true,force:true});}
}
function assertBlocked(result){
  assert.equal(result.status,2);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr,blocked);
}

test('read-only diagnostic executes synthetic code, emits aggregates and verifies exact source-chain argv',async()=>{
  await fixture(async({root,record,execute})=>{
    const before=await evidenceSnapshot(root),result=execute();
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stderr,'');
    const report=JSON.parse(result.stdout);
    assert.equal(report.status,'D6_FOLLOWUP_DIAGNOSTIC_ONLY_NOT_NATIVE_EFFECT_PROOF');
    assert.equal(report.same_run_manifest_roles_verified,11);
    assert.equal(report.capture_source_and_binary_chain_verified,true);
    assert.deepEqual(report.unsupported_opcode_family_hints,{RTI:1});
    assert.equal(report.profile.native_bank_window_samples,5);
    assert.equal(report.profile.native_samples_with_static_codegen,4);
    assert.equal(report.profile.native_samples_without_static_codegen,1);
    assert.equal(report.profile.matched_register_checkpoints,3);
    assert.equal(report.profile.differing_register_checkpoints,0);
    assert.equal(report.profile.cross_reset_checkpoint_boundaries,1);
    assert.equal(report.profile.predicted_writes_native_verified,false);
    assert.equal(report.profile.autonomous_runtime_or_first_frame_verified,false);
    assert.equal(report.profile.private_cpu_or_rom_values_exported,false);
    assert.doesNotMatch(result.stdout,/"(?:pc|bank|before|PC|A|B|X|Y|U|S|DP|CC)"|0x|SYNTHETIC|\b(?:173|169|168|39030|34661|30292|8192|16384|16386|16387)\b/);
    assert.deepEqual(JSON.parse(await readFile(record,'utf8')),{args:[
      'scripts/a063_capture_integrity.py','--verify','--output',resolve(root,'out/r2/mame-probe'),
      '--preflight',locations.preflight,'--mame-bin','/synthetic-protected/mame'],noBytecode:'1'});
    assert.deepEqual(await evidenceSnapshot(root),before);
  });
});

test('modified evidence hash blocks before source-chain verifier and leaves evidence unchanged',async()=>{
  await fixture(async({root,record,execute})=>{
    await save(root,locations.rawtrace,'TAMPERED SYNTHETIC TRACE\n');
    const before=await evidenceSnapshot(root);
    assertBlocked(execute());
    await assert.rejects(lstat(record),{code:'ENOENT'});
    assert.deepEqual(await evidenceSnapshot(root),before);
  });
});

test('failed source or binary chain exports only the fixed marker and preserves evidence',async()=>{
  await fixture(async({root,record,execute})=>{
    const before=await evidenceSnapshot(root);
    assertBlocked(execute(undefined,{D6_TEST_VERIFY_STATUS:'1'}));
    assert.equal(JSON.parse(await readFile(record,'utf8')).noBytecode,'1');
    assert.deepEqual(await evidenceSnapshot(root),before);
  });
});

test('CLI argument errors reject before reading evidence or invoking source verifier',async()=>{
  await fixture(async({root,record,execute})=>{
    await rm(join(root,'out'),{recursive:true});
    for(const args of [[],['--mame-bin'],['--other','/synthetic/mame'],
      ['--mame-bin','/synthetic/mame','--extra']]){
      const result=execute(args);
      assert.equal(result.status,2);
      assert.equal(result.stdout,'');
      assert.equal(result.stderr,'D6_FOLLOWUP=BLOCKED explicit_binary_argument_required\n');
    }
    assertBlocked(execute(['--mame-bin','mame']));
    await assert.rejects(lstat(record),{code:'ENOENT'});
  });
});

test('symlinked evidence and manifest are rejected even with identical target bytes',async()=>{
  for(const path of [locations.trace,manifestPath])await fixture(async({root,record,execute})=>{
    const target=join(root,'synthetic-symlink-target');
    await writeFile(target,await readFile(join(root,path)));
    await rm(join(root,path));
    await symlink(target,join(root,path));
    const before=await evidenceSnapshot(root);
    assertBlocked(execute());
    await assert.rejects(lstat(record),{code:'ENOENT'});
    assert.deepEqual(await evidenceSnapshot(root),before);
  });
});

test('symlinked evidence ancestors cannot redirect an otherwise identical same-run tree',async()=>{
  for(const path of ['out/r2/mame-probe','out'])
    await fixture(async({root,record,execute})=>{
      const target=join(root,'synthetic-ancestor-target');
      await rename(join(root,path),target);
      await symlink(target,join(root,path));
      const before=await evidenceSnapshot(root);
      assertBlocked(execute());
      await assert.rejects(lstat(record),{code:'ENOENT'});
      assert.deepEqual(await evidenceSnapshot(root),before);
    });
});

test('resigned manifest cannot hide full-oracle mismatches or missing evidence roles',async()=>{
  for(const field of ['rom_pair_vs_live_bank_mismatch_count','rom_pair_vs_live_bank_comparisons'])
    await fixture(async({root,execute})=>{
      const oracle=JSON.parse(await readFile(join(root,locations.full_oracle),'utf8'));
      oracle[field]=1;
      await save(root,locations.full_oracle,JSON.stringify(oracle));
      await resign(root);
      const before=await evidenceSnapshot(root);
      assertBlocked(execute());
      assert.deepEqual(await evidenceSnapshot(root),before);
    });
  await fixture(async({root,record,execute})=>{
    const manifest=JSON.parse(await readFile(join(root,manifestPath),'utf8'));
    delete manifest.sha256.capabilities;
    manifest.sha256.unrecognized='0'.repeat(64);
    await save(root,manifestPath,JSON.stringify(manifest));
    assertBlocked(execute());
    await assert.rejects(lstat(record),{code:'ENOENT'});
  });
});
