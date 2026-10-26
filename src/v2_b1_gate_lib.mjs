/** Integrity checks for private offline V2 frame results. No oracle imports. */
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const RECORD_BYTES=0x3800;
const deny=k=>{throw Error('V2_B1_'+k);};
const digest=b=>createHash('sha256').update(b).digest('hex');
const input=(out,name)=>{
  const f=join(out,name),s=lstatSync(f);
  if(!s.isFile()||s.isSymbolicLink())deny('SLOT_SYMLINK');
  return readFileSync(f);
};
const isHash=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
export function verifySlot(out,slot){
  if(!['one','two'].includes(slot))deny('INVALID_SLOT');
  const report=JSON.parse(input(out,slot+'.json').toString('utf8'));
  if(report.schema!=='gng.v2.b1.frozen-run.v1'||report.status!=='FRAMES_DONE'||
     !Number.isInteger(report.frames)||report.frames<1||
     report.frame_hashes?.length!==report.frames||
     report.unknowns?.length!==report.frames||
     report.visible_unknowns?.length!==report.frames||
     !isHash(report.sequence_sha256)||!Array.isArray(report.events))
    deny('SLOT_REPORT_INVALID');
  const frames=input(out,slot+'-frames.bin');
  const known=input(out,slot+'-known.bin');
  const raw=input(out,slot+'-meta.jsonl').toString('utf8').split('\n').filter(Boolean);
  if(frames.length!==report.frames*RECORD_BYTES||known.length!==frames.length||
     raw.length!==report.frames)deny('SLOT_FRAME_LENGTH');
  const rows=raw.map(x=>JSON.parse(x));
  for(let i=0;i<report.frames;i++){
    const start=i*RECORD_BYTES,end=start+RECORD_BYTES;
    const rec=frames.subarray(start,end),mask=known.subarray(start,end);
    const m=rows[i];
    if(m.index!==i+1||!Array.isArray(m.scroll)||m.scroll.length!==4||
       !Array.isArray(m.latch)||m.latch.length!==8||!m.writes||
       !Number.isInteger(report.unknowns[i])||
       !Number.isInteger(report.visible_unknowns[i]))deny('SLOT_META_INVALID');
    const h=digest(Buffer.concat([rec,mask,Buffer.from(JSON.stringify(
      [m.scroll,m.bank,m.latch,m.sprite_buffer_valid,m.writes]))]));
    if(!isHash(report.frame_hashes[i])||h!==report.frame_hashes[i])
      deny('SLOT_FRAME_HASH_MISMATCH');
    let unknown=0;
    for(const k of mask)if(k!==255)unknown++;
    if(unknown!==report.unknowns[i])deny('SLOT_UNKNOWN_MISMATCH');
  }
  if(digest(report.frame_hashes.join('\n')+'\n')!==report.sequence_sha256)
    deny('SLOT_SEQUENCE_HASH_MISMATCH');
  return {report,frames,known,rows};
}
export function compareSlots(a,b){
  if(a.report.frames!==b.report.frames||
     a.report.sequence_sha256!==b.report.sequence_sha256||
     JSON.stringify(a.report.frame_hashes)!==JSON.stringify(b.report.frame_hashes)||
     JSON.stringify(a.report.unknowns)!==JSON.stringify(b.report.unknowns)||
     JSON.stringify(a.report.visible_unknowns)!==JSON.stringify(b.report.visible_unknowns)||
     JSON.stringify(a.report.events)!==JSON.stringify(b.report.events)||
     !a.frames.equals(b.frames)||!a.known.equals(b.known))
    deny('NONDETERMINISTIC');
  return true;
}
