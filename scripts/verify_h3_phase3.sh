#!/usr/bin/env bash
# Gate de aceptación de la fase 3. Desde raíz: bash scripts/verify_h3_phase3.sh FINAL.json
set -euo pipefail
[[ $# -eq 1 ]] || { echo 'USAGE: verify_h3_phase3.sh FINAL_TAPE' >&2; exit 2; }
FINAL="$1"
INPUT=out/h3/explore/tape-fase2-completa-16980.json
[[ -f "$FINAL" && -f "$INPUT" ]] || { echo 'MISSING_TAPE' >&2; exit 2; }
[[ -z "${H3_POKE:-}" ]] || { echo 'H3_POKE_FORBIDDEN' >&2; exit 2; }
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { echo MISSING_FFMPEG >&2; exit 2; }
node --input-type=module - "$INPUT" "$FINAL" <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {selectB3Bundle} from './src/v3_b3_bundle.mjs';
import {resolveB3LabTape} from './src/v3_b3_external_tape.mjs';
const [a,b]=process.argv.slice(2), initial=JSON.parse(fs.readFileSync(a,'utf8')), final=JSON.parse(fs.readFileSync(b,'utf8'));
const CUT=16980*25152;
assert.equal(selectB3Bundle(process.cwd())?.generation,6);
resolveB3LabTape(a);resolveB3LabTape(b);
assert.equal(initial.sha256,'1b77dd6ba5e2798428edb97318b66c106f6bd297fc1fbf15ecffe248df65ccf5');
assert.equal(initial.h3?.goalFrame,16980);
assert.equal(initial.h3?.ramSha,'825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004');
assert.equal(initial.h3?.signal?.phase,2);
assert.equal(initial.h3?.signal?.lives,4);
assert.equal(initial.h3?.signal?.armor,0);
assert.ok(!final.h3?.poke);
assert.ok(Number.isInteger(final.h3?.goalFrame)&&final.h3.goalFrame>16980);
assert.ok(final.frames>final.h3.goalFrame);
assert.equal(final.h3?.signal?.phase,3);
assert.ok(/^[0-9a-f]{64}$/.test(final.h3?.ramSha??''));
assert.ok(Number.isInteger(final.h3?.transitionFrame)&&final.h3.transitionFrame>16980&&final.h3.transitionFrame<=final.h3.goalFrame);
assert.deepEqual(final.events.filter(e=>e.cycle<CUT),initial.events.filter(e=>e.cycle<CUT));
console.log('H3_PHASE3_PREFIX=PASS');
JS
node scripts/h3_explore.mjs replay "$INPUT" | tee /tmp/h3-phase3-initial.log
grep -q 'H3_REPLAY_RESULT MATCH' /tmp/h3-phase3-initial.log
node scripts/h3_explore.mjs replay "$FINAL" | tee /tmp/h3-phase3-final.log
grep -q 'H3_REPLAY_RESULT MATCH' /tmp/h3-phase3-final.log
END=$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).h3.goalFrame)' "$FINAL")
node scripts/h3_video.mjs check "$FINAL" "$END"
node scripts/h3_video.mjs export "$FINAL" "$END" 16980
node --input-type=module - "$FINAL" "$END" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const [p,n]=process.argv.slice(2),end=Number(n),start=16980,t=JSON.parse(fs.readFileSync(p,'utf8'));
const stem=path.basename(p,'.json').replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+t.sha256.slice(0,8)+'-'+start+'-'+end;
const video='out/h3/video/'+stem+'.mp4',metrics='out/h3/video/'+stem+'.json';
assert.ok(fs.existsSync(video)&&fs.existsSync(metrics));
const m=JSON.parse(fs.readFileSync(metrics,'utf8'));
assert.equal(m.ramVerified,true);
assert.equal(m.startFrame,start);assert.equal(m.endFrame,end);assert.equal(m.frames,end-start+1);
const transitions=m.events.filter(e=>e.type==='phase'&&e.from===2&&e.to===3);
assert.equal(transitions.length,1);assert.equal(transitions[0].frame,t.h3.transitionFrame);
const info=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,nb_frames','-of','json',video],{encoding:'utf8'})).streams[0];
assert.equal(info.codec_name,'h264');assert.equal(info.width,256);assert.equal(info.height,224);
assert.equal(Number(info.nb_frames),end-start+1);
console.log('H3_PHASE3_ACCEPTANCE=PASS');
console.log('MP4='+video);console.log('METRICS='+metrics);console.log('TRANSITION='+transitions[0].frame);
JS
