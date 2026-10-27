/**
 * G5: PRIVACY-SAFE YM2203 register-level diagnostic, not a sound generator.
 * Only public hardware register family counts leave this object: no ROM bytes,
 * selected register numbers, command values, sequence or exact timestamps.
 * Uses write pairs: e000/e002 = register select; e001/e003 = register data.
 */
export class YmHealthStop extends Error {
  constructor(code){super(code);this.code=code;}
}
const fresh=()=>({
  portWrites:0,addressWrites:0,dataWrites:0,unpairedDataWrites:0,
  keyOn:0,keyOff:0,psgVolumeNonzero:0,psgVolumeZero:0,
  psgMixerWrites:0,psgToneWrites:0,psgEnvelopeWrites:0,
  fmFrequencyWrites:0,fmOperatorWrites:0,fmAlgorithmWrites:0,
  fmTotalLevelWrites:0,otherDataWrites:0,nonzeroDataWrites:0,
  uniqueSelectedRegisters:new Set()
});
export class YmRegisterHealth {
  constructor() {
    this.chips=[fresh(),fresh()];
    this.selected=[null,null];
  }
  accept(addr,value) {
    if(!Number.isInteger(addr)||addr<0xe000||addr>0xe003||
       !Number.isInteger(value)||value<0||value>255)
      throw new YmHealthStop('AUDIO_YM_HEALTH_BAD_WRITE');
    const chip=(addr-0xe000)>>>1,port=(addr-0xe000)&1;
    const v=this.chips[chip];
    v.portWrites++;
    if(port===0){
      v.addressWrites++;
      this.selected[chip]=value;
      v.uniqueSelectedRegisters.add(value);
      return;
    }
    v.dataWrites++;
    if(value)v.nonzeroDataWrites++;
    const r=this.selected[chip];
    if(r===null){v.unpairedDataWrites++;return;}
    if(r===0x28){
      if((value&0xf0)!==0)v.keyOn++;
      else v.keyOff++;
    } else if(r>=0x08&&r<=0x0a) {
      if((value&0x1f)!==0)v.psgVolumeNonzero++;
      else v.psgVolumeZero++;
    } else if(r===0x07){
      v.psgMixerWrites++;
    } else if(r<=0x06) {
      v.psgToneWrites++;
    } else if(r>=0x0b&&r<=0x0d){
      v.psgEnvelopeWrites++;
    } else if(r>=0xa0&&r<=0xa6) {
      v.fmFrequencyWrites++;
    } else if(r>=0x30&&r<=0x9e) {
      v.fmOperatorWrites++;
      if(r>=0x40&&r<=0x4e)v.fmTotalLevelWrites++;
    } else if(r>=0xb0&&r<=0xb2) {
      v.fmAlgorithmWrites++;
    } else v.otherDataWrites++;
  }
  snapshot() {
    const chips=this.chips.map(chip=>{
      const {uniqueSelectedRegisters,...rest}=chip;
      return Object.freeze({...rest,
        distinctSelectedRegisterCount:uniqueSelectedRegisters.size});
    });
    const sum=k=>chips[0][k]+chips[1][k];
    return Object.freeze({
      kind:'GNG_AUDIO_G5_YM_REGISTER_HEALTH_V1',
      status:'REGISTER_ACTIVITY_ONLY_NOT_AUDIBLE_OR_PARITY',
      chips,
      totalAddressWrites:sum('addressWrites'),
      totalDataWrites:sum('dataWrites'),
      totalUnpairedDataWrites:sum('unpairedDataWrites'),
      totalFmKeyOn:sum('keyOn'),
      totalFmFrequencyWrites:sum('fmFrequencyWrites'),
      totalPsgVolumeNonzero:sum('psgVolumeNonzero'),
      totalPsgToneWrites:sum('psgToneWrites'),
      plausibleToneActivation:sum('keyOn')>0||sum('psgVolumeNonzero')>0,
      pcmSynthesisVerified:false,
      nativeTimingParityVerified:false,
      rawYmDataExported:false
    });
  }
}
