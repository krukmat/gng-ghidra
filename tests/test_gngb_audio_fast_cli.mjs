import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
