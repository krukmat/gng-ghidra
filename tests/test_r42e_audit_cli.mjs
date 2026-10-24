import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {auditR42eLocal} from '../scripts/r42e_native_reference_audit.mjs';
import {verifyR42eSnapshot} from '../src/r42e_snapshot_integrity.mjs';
import {makeR42eReference,makeR42eLabReport} from './r42e_fixture.mjs';
test('E4 local CLI audits private synthetic fixture without asserting native provenance',async()=>{
  const base=resolve('out/r3');
  await mkdir(base,{recursive:true});
  const dir=await mkdtemp(join(base,'r42e-audit-fixture-'));
  try{
    const ref=join(dir,'ref');
    await mkdir(ref);
    const fixture=makeR42eReference();
    await writeFile(join(ref,'manifest.json'),JSON.stringify(fixture.manifest));
    await writeFile(join(ref,'state.json'),JSON.stringify(fixture.state));
    const names={foreground:'foreground.bin',background:'background.bin',
      sprites:'sprites-buffered.bin',palette:'palette-rgba.bin',
      reference:'reference.png'};
    for(const [key,name] of Object.entries(names))
      await writeFile(join(ref,name),fixture.files[key]);
    const snapshot=verifyR42eSnapshot(fixture);
    const report=join(dir,'lab.json');
    await writeFile(report,JSON.stringify(makeR42eLabReport(snapshot)));
    const out=join(dir,'audit.json');
    const audited=await auditR42eLocal({
      referenceDir:ref,labReportPath:report,checkpointId:'synthetic-test',outPath:out
    });
    assert.equal(audited.status,'STRUCTURAL_AUDIT_ONLY_NATIVE_TIMELINE_UNVERIFIED');
    assert.equal(audited.correlation.status,
      'SNAPSHOT_COMPONENTS_MATCH_TEMPORAL_PROOF_MISSING');
    assert.equal(audited.reference.independent_capture_attested,false);
    assert.equal(audited.correlation.native_events_compared,false);
    assert.equal(JSON.parse(await readFile(out,'utf8')).reference.frame,600);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('E4 offline CLI rejects paths outside ignored out and half-specified candidates',async()=>{
  await assert.rejects(auditR42eLocal({referenceDir:'docs'}),
    /R42E_PRIVATE_OUT_PATH_REQUIRED/);
  await assert.rejects(auditR42eLocal({referenceDir:'out/reference/mame',
    labReportPath:'out/r3/checkpoint.json'}),/R42E_LAB_REPORT_AND_CHECKPOINT_REQUIRED_TOGETHER/);
});
