import {test} from 'node:test';
import assert from 'node:assert/strict';
import {locateRgbaTemplate} from '../../bot/perception/template.mjs';

const colors=[
  [255,0,0,255],[0,255,0,255],
  [0,0,255,255],[255,255,255,255],
];
function blank(width=8,height=5){
  const rgba=new Uint8Array(width*height*4);
  for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
  return rgba;
}
function template(){
  return new Uint8Array(colors.flat());
}
function paint(rgba,x,y,width=8){
  for(let i=0;i<colors.length;i++){
    const offset=((y+Math.floor(i/2))*width+x+i%2)*4;
    rgba.set(colors[i],offset);
  }
}
const args=rgba=>({rgba,width:8,height:5,template:template(),
  templateWidth:2,templateHeight:2});

test('a unique high-confidence synthetic sprite is located',()=>{
  const rgba=blank();paint(rgba,3,2);
  const r=locateRgbaTemplate(args(rgba));
  assert.equal(r.label,'MATCH');
  assert.equal(r.x,3);
  assert.equal(r.y,2);
  assert.equal(r.score,1);
  assert.ok(r.margin>=0.04);
});

test('two identical nonoverlapping sprites are ambiguous',()=>{
  const rgba=blank();paint(rgba,0,0);paint(rgba,5,2);
  const r=locateRgbaTemplate(args(rgba));
  assert.equal(r.label,'UNKNOWN');
  assert.equal(r.reason,'AMBIGUOUS_MATCH');
  assert.equal(r.x,null);
});

test('absent template and occluded sprite fail closed',()=>{
  const rgba=blank();
  const absent=locateRgbaTemplate(args(rgba));
  assert.equal(absent.label,'UNKNOWN');
  assert.equal(absent.reason,'WEAK_MATCH');
  paint(rgba,3,2);
  rgba.set([0,0,0,255],((2*8+3)*4));
  assert.equal(locateRgbaTemplate(args(rgba)).label,'UNKNOWN');
});

test('alpha-masked template supports a tightly bounded ROI',()=>{
  const rgba=blank();
  rgba.set([255,0,0,255],((1*8+4)*4));
  const t=template();
  for(let i=7;i<t.length;i+=4)t[i]=0;
  const r=locateRgbaTemplate({...args(rgba),template:t,
    roi:{x:4,y:1,width:2,height:2}});
  assert.equal(r.label,'MATCH');
  assert.equal(r.x,4);
  assert.equal(r.y,1);
});

test('invalid geometry and empty masks never produce a detection',()=>{
  const rgba=blank();
  assert.throws(()=>locateRgbaTemplate({...args(rgba),width:9}),/INPUT/);
  assert.throws(()=>locateRgbaTemplate({...args(rgba),
    roi:{x:7,y:0,width:2,height:2}}),/ROI/);
  const t=template();
  for(let i=3;i<t.length;i+=4)t[i]=0;
  assert.equal(locateRgbaTemplate({...args(rgba),template:t}).reason,
    'EMPTY_TEMPLATE');
});
