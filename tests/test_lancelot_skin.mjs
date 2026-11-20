import test from 'node:test';
import assert from 'node:assert/strict';
import {lancelotOverrides,playerPiece,playerSprites} from '../src/lancelot_skin.mjs';
import {readSpritePen} from '../src/sprite_memory.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';

// ROM-free sprite region where every pixel is pen 6 (planes 1 and 2 set).
const rom=new Uint8Array(0x20000);
rom.fill(0x0f,0,0x10000);rom.fill(0xf0,0x10000);
const sprite=(slot,graphic,paletteGroup,y=100)=>({slot,graphic,paletteGroup,x:40,y,flipX:false,flipY:false});

test('synthetic ROM draws pen 6',()=>{
  assert.equal(readSpritePen(rom,2,0,0),6);
  assert.equal(readSpritePen(rom,0x3ff,15,15),6);
});

test('player pieces are identified by graphic',()=>{
  assert.equal(playerPiece(0x000),'outfit');assert.equal(playerPiece(0x02f),'outfit');
  assert.equal(playerPiece(0x030),null);
  assert.equal(playerPiece(0x100),'body');assert.equal(playerPiece(0x12f),'body');
  assert.equal(playerPiece(0x130),'burst');assert.equal(playerPiece(0x13b),'burst');
  // The armor lying on the ground is another object.
  assert.equal(playerPiece(0x134),null);assert.equal(playerPiece(0x13d),null);
  assert.equal(playerPiece(0x200),null);
});

test('only visible player sprites in palette group 0 are recolored',()=>{
  const sprites=[sprite(5,0x002,0),sprite(6,0x200,0),sprite(7,0x002,1),
    sprite(8,0x102,0),sprite(9,0x000,0,0)];
  assert.deepEqual(playerSprites(sprites).map(s=>s.slot),[5,8]);
  const o=lancelotOverrides(sprites,rom);
  const slots=new Set([...o.keys()].map(k=>k>>8));
  // Outfit pen 6 becomes olive; the body has no armor pens to change.
  assert.deepEqual([...slots],[5]);
  assert.equal(o.size,256);
  assert.equal(o.get(5*256),0x707834);
});

test('renderer refuses a non-function spriteColors',()=>{
  const inputs={videoAddressSpace:new Uint8Array(65536),bufferedSprites:new Uint8Array(0x200),
    chars:new Uint8Array(0x4000),tiles:new Uint8Array(0x18000),sprites:rom,
    palette:new Uint8Array(0x400),scroll:{x:0,y:0}};
  assert.throws(()=>renderGngbRgba({...inputs,spriteColors:{}}),/R42_INVALID_RENDERER_INPUTS/);
  assert.equal(renderGngbRgba({...inputs,spriteColors:()=>new Map()}).width,256);
});

import {gameOptions,difficultyOptions} from '../games/gngb/options.mjs';
import {readPreferences,writePreferences} from '../src/ao_preferences.mjs';

test('character is a game option, kept only for Lancelot',()=>{
  assert.equal(gameOptions({}).character,undefined);
  assert.equal(gameOptions({character:'arthur'}).character,undefined);
  assert.equal(gameOptions({character:'lancelot'}).character,'lancelot');
  assert.equal(difficultyOptions('normal',{character:'lancelot'}).character,'lancelot');
  assert.throws(()=>gameOptions({character:'percival'}),/GNG_OPTIONS_INVALID/);
  // Options without the field (older saves, tapes, peers) are Arthur's.
  assert.deepEqual(gameOptions({lives:3}),gameOptions({lives:3,character:'arthur'}));
});

test('the chosen character is remembered with the other options',()=>{
  const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  writePreferences(difficultyOptions('easy',{character:'lancelot'}),true,storage);
  assert.equal(readPreferences(storage).options.character,'lancelot');
  writePreferences(difficultyOptions('easy'),true,storage);
  assert.equal(readPreferences(storage).options.character,undefined);
});
