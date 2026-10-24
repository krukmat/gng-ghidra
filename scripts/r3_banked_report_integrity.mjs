/**
 * A0.6.4: cross-check the *exact* observed bank/PC histogram against A0.6.3.
 * A matching aggregate total alone is not evidence that rows and report agree.
 * This pure checker does not access ROM, private witness, or host filesystem.
 */
const BANK_COUNT=5;
const BANK_START=0x4000;
const BANK_END=0x5fff;
const FAIL='A064_NATIVE_BANK_DISTRIBUTION_MISMATCH';

export function validateNativeBankReportDetail({report,groups,counts,bankedSamples}){
  const reject=()=>{throw Error(FAIL);};
  if(!report||!Array.isArray(report.bank_pc_pairs)||
      !Array.isArray(groups)||!(counts instanceof Map)||
      !Number.isSafeInteger(bankedSamples)||bankedSamples<1||
      report.bank_pc_pairs.length!==groups.length||
      counts.size!==groups.length||
      !Number.isSafeInteger(report.distinct_bank_window_pcs)||
      !report.observed_bank_counts||
      typeof report.observed_bank_counts!=='object'||
      Array.isArray(report.observed_bank_counts))reject();

  const expected=new Map();
  const observedBankCounts=Array(BANK_COUNT).fill(0);
  const distinctPCs=new Set();
  let sampleTotal=0;
  for(const group of groups){
    if(!Number.isSafeInteger(group?.bank)||group.bank<0||group.bank>=BANK_COUNT||
        !Number.isSafeInteger(group?.pc)||group.pc<BANK_START||group.pc>BANK_END)reject();
    const key=group.bank+':'+group.pc;
    const n=counts.get(key);
    if(expected.has(key)||!Number.isSafeInteger(n)||n<1)reject();
    expected.set(key,n);
    observedBankCounts[group.bank]+=n;
    distinctPCs.add(group.pc);
    sampleTotal+=n;
  }
  if(sampleTotal!==bankedSamples||
      distinctPCs.size!==report.distinct_bank_window_pcs)reject();

  const reported=new Set();
  for(const item of report.bank_pc_pairs){
    if(!Number.isSafeInteger(item?.bank)||item.bank<0||item.bank>=BANK_COUNT||
        typeof item.pc!=='string'||!/^0x[0-9a-f]{4}$/.test(item.pc)||
        !Number.isSafeInteger(item.samples)||item.samples<1)reject();
    const pc=Number.parseInt(item.pc.slice(2),16);
    if(pc<BANK_START||pc>BANK_END)reject();
    const key=item.bank+':'+pc;
    if(reported.has(key)||expected.get(key)!==item.samples)reject();
    reported.add(key);
  }
  if(reported.size!==expected.size||
      Object.keys(report.observed_bank_counts).length!==BANK_COUNT)reject();
  for(let bank=0;bank<BANK_COUNT;bank++){
    if(!Object.hasOwn(report.observed_bank_counts,String(bank))||
        report.observed_bank_counts[String(bank)]!==observedBankCounts[bank])reject();
  }
  return true;
}
