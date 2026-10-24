import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeBankReportDetail} from '../scripts/r3_banked_report_integrity.mjs';

function evidence(){
  const groups=[
    {bank:0,pc:0x4000},{bank:0,pc:0x4002},
    {bank:3,pc:0x4000},{bank:3,pc:0x4002}
  ];
  const counts=new Map([
    ['0:16384',2],['0:16386',1],['3:16384',1],['3:16386',2]
  ]);
  const report={
    distinct_bank_window_pcs:2,
    observed_bank_counts:{'0':3,'1':0,'2':0,'3':3,'4':0},
    bank_pc_pairs:[
      {bank:0,pc:'0x4000',samples:2},{bank:0,pc:'0x4002',samples:1},
      {bank:3,pc:'0x4000',samples:1},{bank:3,pc:'0x4002',samples:2}
    ]
  };
  return {report,groups,counts,bankedSamples:6};
}
test('same-run bank/PC distribution matches exactly, independent of sorting',()=>{
  const x=evidence();
  assert.equal(validateNativeBankReportDetail(x),true);
  x.report.bank_pc_pairs.reverse();
  assert.equal(validateNativeBankReportDetail(x),true);
});
test('preserving aggregate totals does not authorize swapped bank/PC records',()=>{
  const x=evidence();
  [x.report.bank_pc_pairs[0].samples,x.report.bank_pc_pairs[1].samples]=
    [x.report.bank_pc_pairs[1].samples,x.report.bank_pc_pairs[0].samples];
  assert.throws(()=>validateNativeBankReportDetail(x),/A064_NATIVE_BANK_DISTRIBUTION_MISMATCH/);
});
test('same count of distinct pairs cannot hide wrong bank attribution',()=>{
  const x=evidence();
  x.report.bank_pc_pairs[0].bank=3;
  assert.throws(()=>validateNativeBankReportDetail(x),/A064_NATIVE_BANK_DISTRIBUTION_MISMATCH/);
});
test('reject duplicate, missing, malformed and out-of-window report pairs',()=>{
  for(const modify of [
    x=>{x.report.bank_pc_pairs[0]={...x.report.bank_pc_pairs[1]};},
    x=>{x.report.bank_pc_pairs.pop();},
    x=>{x.report.bank_pc_pairs[0].pc='0xzzzz';},
    x=>{x.report.bank_pc_pairs[0].pc='0x6000';},
    x=>{x.report.bank_pc_pairs[0].samples=0;}
  ]){
    const x=evidence();modify(x);
    assert.throws(()=>validateNativeBankReportDetail(x),/A064_NATIVE_BANK_DISTRIBUTION_MISMATCH/);
  }
});
test('reject inconsistent per-bank totals or distinct PCs despite matched samples',()=>{
  for(const modify of [
    x=>{x.report.observed_bank_counts['0']=2;x.report.observed_bank_counts['3']=4;},
    x=>{x.report.distinct_bank_window_pcs=4;},
    x=>{x.report.observed_bank_counts['5']=0;},
    x=>{delete x.report.observed_bank_counts['4'];}
  ]){
    const x=evidence();modify(x);
    assert.throws(()=>validateNativeBankReportDetail(x),/A064_NATIVE_BANK_DISTRIBUTION_MISMATCH/);
  }
});
test('reject forged witness counts and duplicated group keys',()=>{
  const wrong=evidence();wrong.counts.set('0:16384',3);
  assert.throws(()=>validateNativeBankReportDetail(wrong),/A064_NATIVE_BANK_DISTRIBUTION_MISMATCH/);
  const duplicate=evidence();duplicate.groups[0]={...duplicate.groups[1]};
  assert.throws(()=>validateNativeBankReportDetail(duplicate),/A064_NATIVE_BANK_DISTRIBUTION_MISMATCH/);
});

test('128 deterministic distributions reject compensating per-PC count changes',()=>{
  for(let seed=0;seed<128;seed++){
    const x=evidence();
    const hits=[2+seed%5,2+(seed*3)%7,2+(seed*5)%9,2+(seed*7)%11];
    x.report.bank_pc_pairs.forEach((pair,i)=>{pair.samples=hits[i];});
    x.counts=new Map([
      ['0:16384',hits[0]],['0:16386',hits[1]],
      ['3:16384',hits[2]],['3:16386',hits[3]]
    ]);
    x.report.observed_bank_counts['0']=hits[0]+hits[1];
    x.report.observed_bank_counts['3']=hits[2]+hits[3];
    x.bankedSamples=hits.reduce((a,b)=>a+b,0);
    assert.equal(validateNativeBankReportDetail(x),true);
    // Sum and even per-bank totals stay unchanged; only the distribution
    // within one bank was tampered with.
    x.report.bank_pc_pairs[0].samples++;
    x.report.bank_pc_pairs[1].samples--;
    assert.throws(()=>validateNativeBankReportDetail(x),
      /A064_NATIVE_BANK_DISTRIBUTION_MISMATCH/);
  }
});
