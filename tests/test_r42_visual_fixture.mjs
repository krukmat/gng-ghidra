import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderR42FixturePair,fixtureHtml} from '../scripts/r42_visual_fixture.mjs';
test('shared compositor produces two different visual frames only after DMA',()=>{
 const {before,after,report}=renderR42FixturePair();
 assert.equal(report.status,'LAB_SYNTHETIC_VISUAL_DMA_ISOLATION_PASS');
 assert.equal(report.width,256);assert.equal(report.height,224);
 assert.equal(report.changed_rgba_pixels,512);
 assert.notEqual(report.initial_frame_sha256,report.after_dma_frame_sha256);
 assert.equal(report.cpu_writes_without_dma_do_not_affect_pixels,true);
 assert.equal(report.real_rom_or_mame_used,false);
 assert.equal(report.autonomous_cpu_frame_rendered,false);
 assert.equal(report.game_playable,false);
 assert.notDeepEqual(before.rgba,after.rgba);
});
test('visual HTML embeds only synthetic pixels and explicitly disclaims game frame',()=>{
 const pair=renderR42FixturePair(),html=fixtureHtml(pair);
 assert.match(html,/PRUEBA SINTÉTICA — NO ES UN FOTOGRAMA DEL JUEGO/);
 assert.match(html,/Después del segundo DMA/);
 assert.match(html,/const payload=/);
 assert.doesNotMatch(html,/roms\/gng\.zip|private-bank-per-prestate/);
});
