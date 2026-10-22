#!/usr/bin/env node
/**
 * R3.5: one address-specific compiled MC6809 SYNC barrier.
 *
 * The MAME 6809 core's base6x09.lst says that SYNC suspends until an NMI,
 * FIRQ or IRQ line is asserted EVEN IF THE LINE IS MASKED IN CC. Masked
 * requests wake without exception entry. Unmasked requests require a separate
 * IRQ entry/stack/vector implementation that is NOT provided here.
 *
 * Source: https://github.com/mamedev/mame/blob/master/src/devices/cpu/m6809/base6x09.lst
 * No MAME signal is forged from the adjacent CPU prestate.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectPostBootFrontier} from './r3_next_frontier.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {checkedState} from './r3_static_trace_probe.mjs';

export const SYNC_PC=0x6016, RESUME_PC=0x6017;
export function compileSyncAt(rom,pc){
  if(!(rom instanceof Uint8Array) || rom.length!==65536 ||
      rom[0xfffe]!==0x60||rom[0xffff]!==0 ||
      pc!==SYNC_PC || rom[pc]!==0x13)return null;
  return Object.freeze({
    pc,opcode_name:'SYNC',length:1,resume_pc:RESUME_PC,
    waits_for_external_interrupt_line:true,
    wake_requires_interrupt_acceptance:false,
    changes_cc_on_entry:false,
    irq_entry_implemented:false,
  });
}
/** The emission is one STATIC JS block, with no runtime opcode decoding. */
export function emitSyncModule(spec){
  if(!spec || spec.pc!==SYNC_PC ||
      spec.opcode_name!=='SYNC'||spec.length!==1||
      spec.resume_pc!==RESUME_PC)throw Error('R3_UNVERIFIED_SYNC_SPEC');
  return 