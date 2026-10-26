import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const source=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  '../scripts/v3_b2c_live.mjs'),'utf8');
const fixture=source.match(/const html=(`[\s\S]*?`);\r?\n/);
test('browser JS compiles AFTER the Node HTML template is evaluated',()=>{
  assert.ok(fixture,'server HTML template must exist');
  // Trusted source in a test-only parser, NOT in GnG runtime.
  const html=new Function('return '+fixture[1])();
  const script=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script,'browser script must exist');
  assert.doesNotThrow(()=>new Function(script[1]));
});
test('served HTML has canvas, CPU witness and controls',()=>{
  const html=new Function('return '+fixture[1])();
  for(const id of ['screen','status','cpu-input','video-health','restart'])
    assert.ok(html.includes('id="'+id+'"'));
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const endpoint of ['/pixels','/state','/reset','/input'])
    assert.ok(script.includes(endpoint));
  assert.ok(script.includes('ctx.putImageData'));
  assert.ok(script.includes('renderSession===sessionId'));
});
test('frame endpoint carries consistent ID without 409 race',()=>{
  assert.match(source,/'X-GnG-Frame':String\(displayedServerFrame\)/);
  assert.match(source,/'X-GnG-Session':String\(generation\)/);
  assert.doesNotMatch(source,/FRAME_ADVANCED/);
});

test('live HTML exposes real operator Coin and Start hardware buttons',()=>{
  const html=new Function('return '+fixture[1])();
  assert.match(html,/id="coin"/);
  assert.match(html,/id="start"/);
  const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(js,/pulse\('coin1'\)/);
  assert.match(js,/pulse\('start1'\)/);
  assert.match(source,/CPU_HALTED_RESTART/);
});
