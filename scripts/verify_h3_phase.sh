#!/usr/bin/env bash
# Generic phase acceptance gate: <visiblePhase> <initialTape> <finalTape>.
# The legacy scripts/verify_h3_phase3.sh remains unchanged.
set -euo pipefail
[[ $# -eq 3 && "$1" =~ ^[2-9][0-9]*$ ]] || { echo H3_PHASE_VERIFY_USAGE >&2; exit 2; }
PHASE="$1"; INPUT="$2"; FINAL="$3"
[[ -f "$INPUT" && -f "$FINAL" ]] || { echo H3_PHASE_TAPE_MISSING >&2; exit 2; }
[[ -z "$(printenv H3_POKE 2>/dev/null)" ]] || { echo H3_PHASE_POKE_FORBIDDEN >&2; exit 2; }
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { echo H3_PHASE_FFMPEG_MISSING >&2; exit 2; }
mkdir -p "out/h3/phase$PHASE"
LOG="out/h3/phase$PHASE/gate.log"
: > "$LOG"; chmod 600 "$LOG"
node --input-type=module - "$PHASE" "$INPUT" "$FINAL" <<'JS' | tee -a "$LOG"
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveB3LabTape} from './src/v3_b3_external_tape.mjs';
import {selectB3Bundle} from './src/v3_b3_bundle.mjs';
import {assertPhaseCandidate} from './src/h3_phase_contract.mjs';
const [n,a,b]=process.argv.slice(2),visiblePhase=Number(n);
const initial=JSON.parse(fs.readFileSync(a,'utf8')),final=JSON.parse(fs.readFileSync(b,'utf8'));
const contract=assertPhaseCandidate({visiblePhase,initial,candidate:final,end:final.h3?.goalFrame,
  initialSha:resolveB3LabTape(a).sha256,candidateSha:resolveB3LabTape(b).sha256});
assert.equal(selectB3Bundle(process.cwd())?.generation,6,'g6 certified required');
assert.equal(final.h3?.bundle,'g6');
assert.equal(final.h3?.transitionFrom,contract.from);
assert.equal(final.h3?.signal?.phase,contract.to);
assert.ok(Number.isInteger(final.h3?.transitionFrame));
assert.ok(final.h3.transitionFrame>contract.start&&final.h3.transitionFrame<=contract.end);
assert.ok(/^[a-f0-9]{64}$/.test(final.h3.ramSha));
assert.equal(final.h3?.from?.sha256,initial.sha256);
assert.equal(final.h3?.from?.ramSha,initial.h3.ramSha);
assert.equal(final.h3?.from?.goalFrame,contract.start);
assert.ok(Number.isInteger(final.h3?.minLives));
assert.ok(final.h3?.firstFatal===null||Number.isInteger(final.h3?.firstFatal));
console.log('H3_PHASE_PREFIX=PASS visiblePhase='+visiblePhase+' start='+contract.start+' end='+contract.end);
JS
run(){
  printf '$' >> "$LOG"; printf ' %q' "$@" >> "$LOG"; printf '\n' >> "$LOG"
  "$@" 2>&1 | tee -a "$LOG"
}
run node scripts/h3_explore.mjs replay "$INPUT"
run node scripts/h3_explore.mjs replay "$FINAL"
[[ $(grep -c 'H3_REPLAY_RESULT MATCH' "$LOG") -eq 2 ]] || { echo H3_PHASE_REPLAY_NOT_MATCH >&2; exit 1; }
read -r START END < <(node -e 'const fs=require("node:fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const b=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));console.log(a.h3.goalFrame,b.h3.goalFrame)' "$INPUT" "$FINAL")
run node scripts/h3_video.mjs check "$FINAL" "$END"
run node scripts/h3_video.mjs export "$FINAL" "$END" "$START"
node --input-type=module - "$PHASE" "$FINAL" "$START" "$END" <<'JS' | tee -a "$LOG"
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [n,file,s,e]=process.argv.slice(2),phase=Number(n),start=Number(s),end=Number(e);
const final=JSON.parse(fs.readFileSync(file,'utf8'));
const stem=path.basename(file,'.json').replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+final.sha256.slice(0,8)+'-'+start+'-'+end;
const dir='out/h3/video',video=path.join(dir,stem+'.mp4'),metrics=path.join(dir,stem+'.json');
assert.ok(fs.existsSync(video)&&fs.existsSync(metrics),'export missing');
const m=JSON.parse(fs.readFileSync(metrics,'utf8'));
assert.equal(m.ramVerified,true);assert.equal(m.ramSha256,final.h3.ramSha);
assert.equal(m.startFrame,start);assert.equal(m.endFrame,end);
assert.equal(m.frames,end-start+1);
const ev=m.events.filter(e=>e.type==='phase'&&e.from===phase-1&&e.to===phase);
assert.equal(ev.length,1,'expected exactly one phase transition');
assert.equal(ev[0].frame,final.h3.transitionFrame);
const last=m.rows.at(-1);
assert.equal(last?.frame,end);
assert.equal(last?.inGame,true,'final frame must be playable');
assert.equal(last?.phase,phase,'final frame must show phase N+1');
const info=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries',
 'stream=codec_name,width,height,nb_frames','-of','json',video],{encoding:'utf8'})).streams[0];
assert.equal(info.codec_name,'h264');assert.equal(info.width,256);assert.equal(info.height,224);
assert.equal(Number(info.nb_frames),end-start+1);
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(digest(video),m.videoSha256);
const canonicalVideo=path.join(dir,'fase'+phase+'.mp4'),canonicalMetrics=path.join(dir,'fase'+phase+'.json');
fs.renameSync(video,canonicalVideo);fs.renameSync(metrics,canonicalMetrics);
assert.equal(digest(canonicalVideo),m.videoSha256);
console.log('H3_PHASE'+phase+'_ACCEPTANCE=PASS');
console.log('MP4='+canonicalVideo+' METRICS='+canonicalMetrics+' TRANSITION='+ev[0].frame);
console.log('FRAMES='+m.frames+' SHA256_VIDEO='+m.videoSha256);
JS
