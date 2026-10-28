import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function run(relative,args=[]) {
  const result=spawnSync(process.execPath,[relative,...args],{
    cwd:ROOT,encoding:'utf8',timeout:10000
  });
  return {
    exit:result.status,stdout:result.stdout,stderr:result.stderr,
    row:JSON.parse((result.stdout||result.stderr).trim().split('\n').at(-1))
  };
}
test('B1 scanner blocks unsafe output path without emitting ROM bytes',()=>{
  const r=run('scripts/audio_z80_scan.mjs',['--out','out/audio/../../escape.json']);
  assert.equal(r.exit,2);
  assert.equal(r.row.kind,'GNG_AUDIO_Z80_FRONTIER_SCAN_V1');
  assert.equal(r.row.status,'STOP');
  assert.equal(r.row.instruction_bytes_exported,false);
  assert.doesNotMatch(r.stdout+r.stderr,/gg2\.bin:|rom_bytes:|z80AotBlocks/);
});

test('B1 scanner rejects invalid limits before reading private ROM',()=>{
  const r=run('scripts/audio_z80_scan.mjs',['--limit','0']);
  assert.equal(r.exit,2);
  assert.equal(r.row.status,'STOP');
  assert.equal(r.row.report_written_private,false);
});

test('B0+B1 single-command checkpoint rejects unknown flags and never scans',()=>{
  const r=run('scripts/audio_fast_checkpoint.mjs',['--invalid','yes']);
  assert.equal(r.exit,2);
  assert.equal(r.row.kind,'GNG_AUDIO_G5_FAST_CHECKPOINT_V1');
  assert.equal(r.row.status,'STOP_BAD_ARGUMENTS');
});


test('B0 private ROM and AOT artifacts are ignored and untracked',()=>{
  const ignore=readFileSync(resolve(ROOT,'.gitignore'),'utf8');
  assert.match(ignore,/(?:^|\n)out\/(?:\r?\n|$)/);
  const tracked=spawnSync('git',['ls-files','--','out'],{
    cwd:ROOT,encoding:'utf8',timeout:10000
  });
  assert.equal(tracked.status,0);
  assert.equal(tracked.stdout.trim(),'');
});

function withSyntheticWorkspace(runFixture){
  const dir=mkdtempSync(resolve(tmpdir(),'gng-audio-safe-gate-'));
  try {
    mkdirSync(resolve(dir,'scripts'));
    mkdirSync(resolve(dir,'out/audio'),{recursive:true});
    return runFixture(dir);
  } finally {rmSync(dir,{recursive:true,force:true});}
}
function runFinalFixture(dir,gateSource){
  writeFileSync(resolve(dir,'scripts/audio_fast_checkpoint.mjs'),gateSource);
  const result=spawnSync(process.execPath,[resolve(ROOT,'scripts/audio_live_final.mjs')],{
    cwd:dir,encoding:'utf8',timeout:10000
  });
  return {...result,row:JSON.parse(result.stdout.trim().split('\n').at(-1))};
}

test('G5 final STOP retains safe regression cause and counts without child payloads',()=>{
  withSyntheticWorkspace(dir=>{
    const gate={kind:'GNG_AUDIO_G5_FAST_CHECKPOINT_V1',status:'STOP_REGRESSION',
      node:{exit_code:1,ran:130,passed:129,failed:1,
        failing_test_names:['B4.T3-B unsafe input, forged roots and impossible bounds fail closed',
          '/Users/SECRET/gg2.bin','PRIVATE_ASCII_PAYLOAD']},
      python:{exit_code:0,ran:78,ok:true,failed:false,failing_test_names:[]},
      stderr:'PRIVATE_CHILD_PAYLOAD',rom:'PRIVATE_ROM_CONTENT'};
    const r=runFinalFixture(dir,
      'console.log('+JSON.stringify(JSON.stringify(gate))+');process.exitCode=2;');
    assert.equal(r.status,2);
    assert.equal(r.row.reason,'AUDIO_FINAL_REGRESSION_GATE_STOP');
    assert.equal(r.row.execution,null);
    assert.equal(r.row.checkpoint.status,'STOP_REGRESSION');
    assert.equal(r.row.checkpoint.gate_exit_code,2);
    assert.equal(r.row.checkpoint.node.failed,1);
    assert.equal(r.row.checkpoint.python.ran,78);
    assert.deepEqual(r.row.checkpoint.node.failing_test_names,
      ['B4.T3-B unsafe input, forged roots and impossible bounds fail closed']);
    assert.doesNotMatch(r.stdout+r.stderr,/SECRET|PRIVATE_|gg2\.bin/);
  });
});

test('G5 final STOP preserves safe scan or build failure and handles malformed reports',()=>{
  withSyntheticWorkspace(dir=>{
    for(const stage of ['scan','build']){
      const gate={kind:'GNG_AUDIO_G5_FAST_CHECKPOINT_V1',
        status:stage==='scan'?'STOP_ROM_OR_SCAN':'STOP_AOT_BUILD',
        ['z80_'+stage+'_exit_code']:2,
        ['z80_'+stage+'_reason']:'AUDIO_SYNTHETIC_INPUT_MISSING',
        private:'PRIVATE_CHILD_PAYLOAD'};
      const r=runFinalFixture(dir,
        'console.log('+JSON.stringify(JSON.stringify(gate))+');process.exitCode=2;');
      assert.equal(r.row.reason,'AUDIO_FINAL_REGRESSION_GATE_STOP');
      assert.equal(r.row.checkpoint.status,gate.status);
      assert.equal(r.row.checkpoint['z80_'+stage+'_exit_code'],2);
      assert.equal(r.row.checkpoint['z80_'+stage+'_reason'],
        'AUDIO_SYNTHETIC_INPUT_MISSING');
      assert.doesNotMatch(r.stdout+r.stderr,/PRIVATE_CHILD_PAYLOAD/);
    }
    const r=runFinalFixture(dir,'console.log("PRIVATE_MALFORMED_REPORT");');
    assert.equal(r.row.reason,'AUDIO_FINAL_REGRESSION_FORMAT_STOP');
    assert.equal(r.row.checkpoint.status,'INVALID_CHECKPOINT_REPORT');
    assert.doesNotMatch(r.stdout+r.stderr,/PRIVATE_MALFORMED_REPORT/);
  });
});

test('G5 fast checkpoint reports literal public failing Node names without assertions',()=>{
  withSyntheticWorkspace(dir=>{
    const source=readFileSync(resolve(ROOT,'scripts/audio_fast_checkpoint.mjs'),'utf8');
    const files=[...source.matchAll(/'tests\/[^']+\.mjs'/g)]
      .map(match=>match[0].slice(1,-1));
    mkdirSync(resolve(dir,'tests'));
    for(const [index,file] of files.entries()){
      const body=index===0?
        "assert.equal('PRIVATE_ASSERTION_BYTES','OTHER');":"assert.equal(1,1);";
      writeFileSync(resolve(dir,file),
        "import test from 'node:test';import assert from 'node:assert/strict';"+
        "test('Synthetic public gate test',()=>{"+body+"});");
    }
    writeFileSync(resolve(dir,'tests/test_audio_fixture.py'),
      'import unittest\nclass Fixture(unittest.TestCase):\n def test_safe(self): self.assertTrue(True)\n');
    writeFileSync(resolve(dir,'.gitignore'),'out/\n');
    assert.equal(spawnSync('git',['init','-q',dir]).status,0);
    const result=spawnSync(process.execPath,[resolve(ROOT,'scripts/audio_fast_checkpoint.mjs')],{
      cwd:dir,encoding:'utf8',timeout:10000,
      env:Object.fromEntries(Object.entries(process.env)
        .filter(([key])=>key!=='NODE_TEST_CONTEXT'))
    });
    const row=JSON.parse(result.stdout.trim());
    assert.equal(result.status,2);
    assert.equal(row.status,'STOP_REGRESSION');
    assert.equal(row.node.failed,1);
    assert.deepEqual(row.node.failing_test_names,['Synthetic public gate test']);
    assert.equal(row.python.ran,1);
    assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE_ASSERTION_BYTES|AssertionError/);
    // The real scanner/compiler report safe errors on stderr with `error`,
    // not stdout with `reason`. Preserve both forms through the fast gate.
    writeFileSync(resolve(dir,files[0]),
      "import test from 'node:test';test('Synthetic public gate test',()=>{});");
    const scanFail={kind:'GNG_AUDIO_Z80_FRONTIER_SCAN_V1',status:'STOP',
      error:'AUDIO_SCAN_INPUT_OR_RUNTIME_STOP'};
    writeFileSync(resolve(dir,'scripts/audio_z80_scan.mjs'),
      'console.error('+JSON.stringify(JSON.stringify(scanFail))+');process.exitCode=2;');
    const invokeGate=()=>{
      const r=spawnSync(process.execPath,[resolve(ROOT,'scripts/audio_fast_checkpoint.mjs')],{
        cwd:dir,encoding:'utf8',timeout:10000,
        env:Object.fromEntries(Object.entries(process.env)
          .filter(([key])=>key!=='NODE_TEST_CONTEXT'))
      });
      assert.equal(r.status,2);
      return JSON.parse(r.stdout.trim());
    };
    const scan=invokeGate();
    assert.equal(scan.status,'STOP_ROM_OR_SCAN');
    assert.equal(scan.z80_scan_exit_code,2);
    assert.equal(scan.z80_scan_reason,'AUDIO_SCAN_INPUT_OR_RUNTIME_STOP');
    const scanPass={kind:'GNG_AUDIO_Z80_FRONTIER_SCAN_V1',
      status:'PARTIAL_UNCERTIFIED',rom_identity:'SHA1_MATCH'};
    writeFileSync(resolve(dir,'scripts/audio_z80_scan.mjs'),
      'console.log('+JSON.stringify(JSON.stringify(scanPass))+');process.exitCode=2;');
    for(const error of ['AUDIO_Z80_ROM_IDENTITY_MISMATCH','READ_OR_BUILD_FAILED']){
      const buildFail={kind:'GNG_AUDIO_Z80_AOT_PREFIX_V1',status:'STOP',error};
      writeFileSync(resolve(dir,'scripts/audio_z80_build.mjs'),
        'console.error('+JSON.stringify(JSON.stringify(buildFail))+');process.exitCode=2;');
      const build=invokeGate();
      assert.equal(build.status,'STOP_AOT_BUILD');
      assert.equal(build.z80_build_exit_code,2);
      assert.equal(build.z80_build_reason,error==='READ_OR_BUILD_FAILED'?
        'AUDIO_Z80_READ_OR_BUILD_FAILED':error);
    }
  });
});
