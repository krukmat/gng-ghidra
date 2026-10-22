/**
 * A0.6: authentic gngb read-only 5-entry, 8 KiB CPU bank window.
 *
 * gng.cpp:
 *  map(0x4000, 0x5fff).bankr(m_mainbank);
 *  configure_entries(0,4,maincpu+0x10000,0x2000);
 *  configure_entry(4, maincpu+0x4000);
 *  bankswitch_w(data): data===4 ? 4 : data&3.
 *
 * Source bytes MUST come from the CRC-verified local gngb ZIP via
 * scripts/r3_bank_inventory.py. No bank is selected by default:
 * existing frame-level samples do not establish the power-on selection
 * nor an instruction-specific bank-change boundary.
 *
 * This is a ROM read adapter, NOT an MC6809 interpreter, and does not
 * validate the native CPU's selection timing or IRQ/SYNC semantics.
 */
export const GNG_BANK_COUNT=5;
export const GNG_BANK_SIZE=0x2000;
export const GNG_BANK_START=0x4000;
export const GNG_BANK_END=0x5fff;
const SIZE=GNG_BANK_COUNT*GNG_BANK_SIZE;

export function entryFromBankControl(value){
  if(!Number.isInteger(value)||value<0||value>255)
    throw new RangeError('GNG_BANK_SELECT_BYTE_INVALID');
  return value===4?4:value&3;
}
export function createGngbBankedRom(packed){
  if(!(packed instanceof Uint8Array)||packed.length!==SIZE)
    throw new RangeError('GNG_FIVE_AUTHENTIC_BANK_IMAGES_REQUIRED');
  // Isolate mutable file/image callers; never export a writable ROM alias.
  const bankBytes=Uint8Array.from(packed);
  let active=null,selectWrites=0,bankReads=0;
  function selectFromControlWrite(value){
    active=entryFromBankControl(value);
    selectWrites++;
    return active;
  }
  function read8(address){
    if(!Number.isInteger(address)||address<GNG_BANK_START||
        address>GNG_BANK_END)
      throw new RangeError('GNG_BANKED_READ_OUTSIDE_WINDOW');
    if(active===null)
      throw Error('GNG_BANK_ENTRY_UNKNOWN_UNTIL_EXPLICIT_SELECTION');
    bankReads++;
    return bankBytes[active*GNG_BANK_SIZE+address-GNG_BANK_START];
  }
  function stats(){
    return {
      schema:'gng.a06.banked-read-adapter.v1',
      active_bank_entry:active,
      explicit_selection_writes:selectWrites,
      banked_reads:bankReads,
      bank_entries_loaded:GNG_BANK_COUNT,
      power_on_bank_entry_verified:false,
      per_instruction_native_bank_provenance_verified:false,
      native_bank_switch_timing_verified:false,
      full_cpu_or_game_equivalence_verified:false,
      game_playable:false
    };
  }
  return Object.freeze({selectFromControlWrite,read8,stats});
}
