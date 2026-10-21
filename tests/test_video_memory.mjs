import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 FG_START,BG_START,TILEMAP_SIZE,FG_REGION_SIZE,BG_REGION_SIZE,
 readTilePen,tileAddress,writeTile,readTile,screenTile,
 bgPixelLayer,changedTileBytes
} from '../src/video_memory.mjs';

function mem(){return new Uint8Array(65536);}
test('tilemap memory is FG rows at 0x2000 and BG columns at 0x2800',()=>{
 assert.equal(FG_START,0x2000);
 assert.equal(BG_START,0x2800);
 assert.equal(TILEMAP_SIZE,0x800);
 assert.equal(tileAddress('fg',2,3),0x2000+3*32+2);
 assert.equal(tileAddress('bg',2,3),0x2800+2*32+3);
 assert.equal(tileAddress('bg',31,31),0x2bff);
 assert.throws(()=>tileAddress('fg',32,1),/out of bounds/);
 assert.throws(()=>tileAddress('bg',3,-1),/out of bounds/);
});
test('BG 3bpp and FG 2bpp exact ROM bitplane offsets',()=>{
 const bg=new Uint8Array(BG_REGION_SIZE);
 const fg=new Uint8Array(FG_REGION_SIZE);
 bg[0]=0x80;
 bg[0x8000]=0x80;
 bg[0x10000]=0x80;
 assert.equal(readTilePen('bg',bg,0,0,0),7);
 assert.equal(readTilePen('bg',bg,0,1,0),0);
 bg[128/8]=0x80;  // second 8-pixel half uses +128 bit
 assert.equal(readTilePen('bg',bg,0,8,0),1);
 fg[0]=0x88;fg[1]=0x88;
 assert.equal(readTilePen('fg',fg,0,0,0),3);
 assert.equal(readTilePen('fg',fg,0,4,0),3);
 assert.throws(()=>readTilePen('bg',fg,0,0,0),/Missing graphics region/);
 assert.throws(()=>readTilePen('fg',fg,1024,0,0),/out of bounds/);
});
test('MAME drawgfx plane order uses most-significant bit first, independently per plane',()=>{
 const bg=new Uint8Array(BG_REGION_SIZE),fg=new Uint8Array(FG_REGION_SIZE);
 bg[0x10000]=0x80; // first declared plane -> bit 2
 assert.equal(readTilePen('bg',bg,0,0,0),4);
 bg[0x10000]=0; bg[0x8000]=0x80;
 assert.equal(readTilePen('bg',bg,0,0,0),2);
 bg[0x8000]=0; bg[0]=0x80;
 assert.equal(readTilePen('bg',bg,0,0,0),1);
 fg[0]=0x08; // first char plane offset +4 -> bit 1
 assert.equal(readTilePen('fg',fg,0,0,0),2);
 fg[0]=0x80; // second char plane offset +0 -> bit 0
 assert.equal(readTilePen('fg',fg,0,0,0),1);
});
test('BG/FG attributes preserve MAME code high bits, flips and group',()=>{
 const memory=mem();
 writeTile(memory,'bg',2,3,0x3a5,5,true,true,1);
 const bg=readTile(memory,'bg',2,3);
 assert.equal(bg.addr,0x2800+2*32+3);
 assert.equal(bg.graphic,0x3a5);
 assert.equal(bg.palette,5);
 assert.equal(bg.group,1);
 assert.equal(bg.flipX,true);
 assert.equal(bg.flipY,true);
 assert.deepEqual(bg.bytes,[0xa5,0xfD]);
 writeTile(memory,'fg',7,3,0x244,13,true,false);
 const fg=readTile(memory,'fg',7,3);
 assert.equal(fg.addr,0x2000+3*32+7);
 assert.equal(fg.graphic,0x244);
 assert.equal(fg.palette,13);
 assert.equal(fg.group,0);
 assert.equal(fg.flipX,true);
 assert.equal(fg.flipY,false);
 assert.throws(()=>writeTile(memory,'bg',0,0,0x400),/out of bounds/);
 assert.throws(()=>writeTile(memory,'bg',0,0,0x100,8),/Palette/);
});
test('background scroll wraps across 512px with 16x16 col-major tiles',()=>{
 const memory=mem();
 writeTile(memory,'bg',0,0,0x10,2);
 writeTile(memory,'bg',2,1,0x20,3,true,false);
 writeTile(memory,'bg',31,31,0x30,1);
 let t=screenTile(memory,'bg',0,0,32,16);
 assert.equal(t.graphic,0x20);
 assert.equal(t.x,15);
 assert.equal(t.y,0);
 t=screenTile(memory,'bg',0,0,-1,-1);
 assert.equal(t.graphic,0x30);
 assert.equal(t.x,15);
 assert.equal(t.y,15);
 t=screenTile(memory,'bg',0,0,512,512);
 assert.equal(t.graphic,0x10);
});
test('foreground is 8x8 row-major and can flip coordinates',()=>{
 const memory=mem();
 writeTile(memory,'fg',4,5,0x22,1,true,true);
 const t=screenTile(memory,'fg',4*8+3,5*8+2);
 assert.equal(t.graphic,0x22);
 assert.equal(t.x,4);assert.equal(t.y,5);
 const wrapped=screenTile(memory,'fg',4*8+3,5*8+2,256,256);
 assert.equal(wrapped.graphic,0x22);
});
test('MAME background split-priority mask exactly matches hardware table',()=>{
 for(let pen=0;pen<8;pen++){
   assert.equal(bgPixelLayer(0,pen,'back'),true);
   assert.equal(bgPixelLayer(0,pen,'front'),false);
   assert.equal(bgPixelLayer(1,pen,'back'),pen===0||pen===6);
   assert.equal(bgPixelLayer(1,pen,'front'),pen!==0&&pen!==6);
 }
 assert.throws(()=>bgPixelLayer(2,0,'front'),/Invalid/);
 assert.throws(()=>bgPixelLayer(0,9,'back'),/Invalid/);
});
test('BG and FG modified registers produce auditable exact RAM deltas',()=>{
 const a=mem(),b=mem();
 writeTile(b,'bg',1,3,100,7,true,false,1);
 writeTile(b,'fg',1,3,55,7);
 const bg=changedTileBytes(a,b,'bg');
 const fg=changedTileBytes(a,b,'fg');
 assert.equal(bg.length,2);
 assert.equal(fg.length,2);
 assert.deepEqual(new Set(bg.map(v=>v.field)),new Set(['code','attribute']));
 assert.deepEqual(new Set(fg.map(v=>v.field)),new Set(['code','attribute']));
 assert.ok(bg.every(v=>v.addr>=0x2800&&v.addr<0x3000));
 assert.ok(fg.every(v=>v.addr>=0x2000&&v.addr<0x2800));
 assert.throws(()=>changedTileBytes(new Uint8Array(10),b,'bg'),/64KiB/);
});
