// AO-5: incremental dual-YM2203 synthesizer for a WebAssembly Worker.
// Same synthesis as `audio_ym2203_lab --stream` (12 MHz master, 1.5 MHz chips,
// OPN_FIDELITY_MIN, MAME gng.cpp gains, mono Int16 at 62.5 kHz), with the
// stdin protocol replaced by calls: W -> ao_ym_write, R -> ao_ym_reset,
// U -> ao_ym_render, S -> ao_ym_save, L -> ao_ym_load (same bytes as the
// native S/L, src/ym2203_checkpoint.h). No I/O, threads or exceptions;
// errors are sticky codes.
#include "ymfm_opn.h"
#include "ym2203_checkpoint.h"
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace {
constexpr uint64_t master_hz=12000000;
constexpr uint32_t chip_hz=1500000;
constexpr uint32_t sample_hz=chip_hz/24; // OPN_FIDELITY_MIN = 62500 Hz
constexpr uint64_t ticks_per_sample=master_hz/sample_hz; // 192 ticks
constexpr uint32_t max_block=12500;
constexpr uint32_t max_checkpoint=4096; // GYM1 blob, both chips

// Codes returned as negative numbers; the JS loader maps them to names.
enum code : int32_t {
  OK=0, CLOCK_INVALID=1, WRITE_INVALID=2, CHUNK_TOO_LARGE=3, STOPPED=4,
  SAVE_INVALID=5, LOAD_INVALID=6,
};
class lab_interface : public ymfm::ymfm_interface {
  // No timer/IRQ interactions claimed, as in the native renderer.
};
int16_t mix(ymfm::ym2203 &a,ymfm::ym2203 &b) {
  ymfm::ym2203::output_data x{},y{};
  a.generate(&x);b.generate(&y);
  // MAME gng.cpp mixer route gains: FM, SSG 1/2=0.4; SSG 3=0.2.
  // The native arm64 build contracts this sum into four fmadd (one rounding
  // each); WebAssembly has no contraction, so the fused form is explicit.
  double signal=0;
  for(int i=0;i<4;i++)
    signal=std::fma(i==3 ? 0.2 : 0.4,double(x.data[i]+y.data[i]),signal);
  return static_cast<int16_t>(
    std::clamp(static_cast<int32_t>(signal),-32768,32767));
}
struct synth {
  lab_interface intf0,intf1;
  ymfm::ym2203 ym0,ym1;
  uint64_t first=0,next=0,frontier=0,lastEvent=0,blockFirst=0;
  uint32_t pending=0;
  int32_t error=OK;
  bool fresh=true; // no command yet: only then may a checkpoint be loaded
  int16_t pcm[max_block];
  uint8_t checkpoint[max_checkpoint];
  synth():ym0(intf0),ym1(intf1) {
    ym0.set_fidelity(ymfm::OPN_FIDELITY_MIN);
    ym1.set_fidelity(ymfm::OPN_FIDELITY_MIN);
    ym0.reset();ym1.reset();
  }
  int32_t stop(int32_t c){error=c;return -c;}
  // Same clock rule as the native parser: never before the last render
  // frontier or the last event, never beyond one hour.
  bool clock(double t,uint64_t &tick) {
    if(!(t>=0) || t>double(master_hz*3600) || std::floor(t)!=t)return false;
    tick=static_cast<uint64_t>(t);
    return tick>=frontier && tick>=lastEvent;
  }
  bool advance(uint64_t tick) {
    const uint64_t end=(tick+ticks_per_sample-1)/ticks_per_sample;
    if(end<next || end-first>max_block)return false;
    for(;next<end;next++)pcm[pending++]=mix(ym0,ym1);
    return true;
  }
};
}

extern "C" {
synth *ao_ym_create() { return new synth(); }
void ao_ym_destroy(synth *s) { delete s; }
int32_t ao_ym_error(synth *s) { return s->error; }

int32_t ao_ym_write(synth *s,double t,uint32_t addr,uint32_t value) {
  if(s->error)return -STOPPED;
  s->fresh=false;
  uint64_t tick;
  if(!s->clock(t,tick))return s->stop(CLOCK_INVALID);
  if(addr<0xe000 || addr>0xe003 || value>255)return s->stop(WRITE_INVALID);
  if(!s->advance(tick))return s->stop(CHUNK_TOO_LARGE);
  const uint32_t offset=addr-0xe000;
  (offset<2 ? s->ym0 : s->ym1).write(offset&1,value);
  s->lastEvent=tick;
  return OK;
}
// Chip reset at tick: the sample timeline continues, it is never rewound.
int32_t ao_ym_reset(synth *s,double t) {
  if(s->error)return -STOPPED;
  s->fresh=false;
  uint64_t tick;
  if(!s->clock(t,tick))return s->stop(CLOCK_INVALID);
  if(!s->advance(tick))return s->stop(CHUNK_TOO_LARGE);
  s->ym0.reset();s->ym1.reset();
  s->lastEvent=tick;
  return OK;
}
// Exclusive frontier: events exactly on tick belong to the next request,
// before its first sample. Returns the block size; the block starts at
// ao_ym_block_first and lives in ao_ym_pcm until the next render.
int32_t ao_ym_render(synth *s,double t) {
  if(s->error)return -STOPPED;
  s->fresh=false;
  uint64_t tick;
  if(!s->clock(t,tick))return s->stop(CLOCK_INVALID);
  if(!s->advance(tick))return s->stop(CHUNK_TOO_LARGE);
  const int32_t n=static_cast<int32_t>(s->pending);
  s->blockFirst=s->first;
  s->first=s->next;s->frontier=tick;s->lastEvent=tick;
  s->pending=0;
  return n;
}
const int16_t *ao_ym_pcm(synth *s) { return s->pcm; }
double ao_ym_block_first(synth *s) { return double(s->blockFirst); }
// Checkpoint bytes live in ao_ym_checkpoint. Save only after a render (no
// pending samples); returns the size. Load reads n bytes from the same
// buffer, only as the first call on a fresh synthesizer.
uint8_t *ao_ym_checkpoint(synth *s) { return s->checkpoint; }
int32_t ao_ym_save(synth *s) {
  if(s->error)return -STOPPED;
  if(s->pending)return s->stop(SAVE_INVALID);
  const auto bytes=ymck::save(s->ym0,s->ym1,
    {s->first,s->next,s->frontier,s->lastEvent});
  if(bytes.size()>max_checkpoint)return s->stop(SAVE_INVALID);
  std::copy(bytes.begin(),bytes.end(),s->checkpoint);
  s->fresh=false;
  return static_cast<int32_t>(bytes.size());
}
int32_t ao_ym_load(synth *s,uint32_t n) {
  if(s->error)return -STOPPED;
  ymck::timeline t;
  if(!s->fresh || n>max_checkpoint ||
     !ymck::load(s->ym0,s->ym1,t,s->checkpoint,n))return s->stop(LOAD_INVALID);
  s->first=t.first;s->next=t.next;s->frontier=t.frontier;
  s->lastEvent=t.lastEvent;s->fresh=false;
  return OK;
}
}
