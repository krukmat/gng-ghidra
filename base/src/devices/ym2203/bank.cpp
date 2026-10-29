// Parameterized YM2203 bank for a standalone WebAssembly module: one to four
// ymfm YM2203 at OPN_FIDELITY_MIN, mixed to mono Int16. The board supplies the
// chip count, its event clock, the chip clock, one gain per output route (FM,
// SSG A, B, C; shared by every chip) and the largest PCM block. Address
// decoding, reset wiring and clock relations stay in the board.
// Time is in board ticks; sample n is chip clocks [24n, 24n+24). Prescaler
// register changes are not modeled: the sample rate stays chip_hz/24.
// No I/O, threads or exceptions; errors are sticky codes.
#include "ymfm_opn.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>
#include <numeric>
#include <vector>

namespace {
constexpr uint32_t max_chips=4;
constexpr uint32_t max_block_limit=65536;
constexpr double max_gain=4;

// Codes returned as negative numbers; the JS loader maps them to names.
enum code : int32_t {
  OK=0, CLOCK_INVALID=1, WRITE_INVALID=2, CHUNK_TOO_LARGE=3, STOPPED=4,
  SAVE_INVALID=5, LOAD_INVALID=6,
};
class quiet_interface : public ymfm::ymfm_interface {
  // No timer/IRQ interactions claimed.
};
struct chip {
  quiet_interface intf;
  ymfm::ym2203 ym;
  chip():ym(intf) { ym.set_fidelity(ymfm::OPN_FIDELITY_MIN); ym.reset(); }
};
// Checkpoint layout "GYM1", little-endian: u64 first, next, frontier,
// lastEvent, then per chip u32 size + ymfm save_restore bytes.
void put(std::vector<uint8_t> &out,uint64_t x,int bytes) {
  for(int i=0;i<bytes;i++)out.push_back(static_cast<uint8_t>(x>>(8*i)));
}
uint64_t get(const uint8_t *p,int bytes) {
  uint64_t x=0;
  for(int i=0;i<bytes;i++)x|=uint64_t(p[i])<<(8*i);
  return x;
}
std::vector<uint8_t> chip_bytes(ymfm::ym2203 &ym) {
  std::vector<uint8_t> blob;
  ymfm::ymfm_saved_state state(blob,true);
  ym.save_restore(state);
  return blob;
}
struct bank {
  uint32_t chips=0;
  std::unique_ptr<chip[]> chip_state;
  double gains[4]={};
  uint64_t num=1,den=1,max_tick=0; // samples = ceil(tick*num/den)
  uint32_t sample_rate=0,max_block=0;
  size_t chip_state_bytes=0;
  uint64_t first=0,next=0,frontier=0,lastEvent=0,blockFirst=0;
  uint32_t pending=0;
  int32_t error=OK;
  bool fresh=true; // no command yet: only then may a checkpoint be loaded
  std::unique_ptr<int16_t[]> pcm;
  std::vector<uint8_t> checkpoint;

  int32_t stop(int32_t c){error=c;return -c;}
  int16_t mix() {
    ymfm::ym2203::output_data out[max_chips]{};
    for(uint32_t c=0;c<chips;c++)chip_state[c].ym.generate(&out[c]);
    // Each route sums its chips exactly, then one fused multiply-add per
    // route. WebAssembly has no contraction, so the fused form is explicit;
    // it matches a native arm64 build that contracts the sum.
    double signal=0;
    for(int i=0;i<4;i++) {
      int32_t sum=out[0].data[i];
      for(uint32_t c=1;c<chips;c++)sum+=out[c].data[i];
      signal=std::fma(gains[i],double(sum),signal);
    }
    return static_cast<int16_t>(
      std::clamp(static_cast<int32_t>(signal),-32768,32767));
  }
  // Never before the last render frontier or the last event, never beyond
  // one hour of board ticks.
  bool clock(double t,uint64_t &tick) {
    if(!(t>=0) || t>double(max_tick) || std::floor(t)!=t)return false;
    tick=static_cast<uint64_t>(t);
    return tick>=frontier && tick>=lastEvent;
  }
  bool advance(uint64_t tick) {
    const uint64_t end=(tick*num+den-1)/den;
    if(end<next || end-first>max_block)return false;
    for(;next<end;next++)pcm[pending++]=mix();
    return true;
  }
};
}

extern "C" {
// Returns null for an unsupported configuration: chips 1..4, integral board
// tick rate, chip clock a multiple of 24 Hz (integral sample rate), finite
// gains in [0, 4] and a block of 1..65536 samples.
bank *ym2203_create(uint32_t chips,double tick_hz,uint32_t chip_hz,
    double g0,double g1,double g2,double g3,uint32_t max_block) {
  const double g[4]={g0,g1,g2,g3};
  if(chips<1 || chips>max_chips || !(tick_hz>=1) || tick_hz>4294967295.0 ||
     std::floor(tick_hz)!=tick_hz || chip_hz<24 || chip_hz%24 ||
     max_block<1 || max_block>max_block_limit)return nullptr;
  for(double x:g)if(!(x>=0 && x<=max_gain))return nullptr;
  const uint64_t ticks=static_cast<uint64_t>(tick_hz),rate=chip_hz/24;
  const uint64_t common=std::gcd(ticks,rate);
  bank *s=new bank();
  s->chips=chips;
  std::copy(g,g+4,s->gains);
  s->sample_rate=static_cast<uint32_t>(rate);
  s->num=rate/common;s->den=ticks/common;s->max_tick=ticks*3600;
  uint64_t product;
  if(__builtin_mul_overflow(s->max_tick,s->num,&product) ||
     product>UINT64_MAX-s->den){delete s;return nullptr;}
  s->max_block=max_block;
  s->chip_state.reset(new chip[chips]);
  s->pcm.reset(new int16_t[max_block]);
  s->chip_state_bytes=chip_bytes(s->chip_state[0].ym).size();
  s->checkpoint.resize(36+chips*(4+s->chip_state_bytes));
  return s;
}
void ym2203_destroy(bank *s) { delete s; }
int32_t ym2203_error(bank *s) { return s->error; }
uint32_t ym2203_sample_rate(bank *s) { return s->sample_rate; }

int32_t ym2203_write(bank *s,double t,uint32_t chip,uint32_t port,
    uint32_t value) {
  if(s->error)return -STOPPED;
  s->fresh=false;
  uint64_t tick;
  if(!s->clock(t,tick))return s->stop(CLOCK_INVALID);
  if(chip>=s->chips || port>1 || value>255)return s->stop(WRITE_INVALID);
  if(!s->advance(tick))return s->stop(CHUNK_TOO_LARGE);
  s->chip_state[chip].ym.write(port,value);
  s->lastEvent=tick;
  return OK;
}
// Resets every chip at tick: the sample timeline continues, it is never
// rewound. Separate reset lines per chip are not modeled.
int32_t ym2203_reset(bank *s,double t) {
  if(s->error)return -STOPPED;
  s->fresh=false;
  uint64_t tick;
  if(!s->clock(t,tick))return s->stop(CLOCK_INVALID);
  if(!s->advance(tick))return s->stop(CHUNK_TOO_LARGE);
  for(uint32_t c=0;c<s->chips;c++)s->chip_state[c].ym.reset();
  s->lastEvent=tick;
  return OK;
}
// Exclusive frontier: events exactly on tick belong to the next request,
// before its first sample. Returns the block size; the block starts at
// ym2203_block_first and lives in ym2203_pcm until the next render.
int32_t ym2203_render(bank *s,double t) {
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
const int16_t *ym2203_pcm(bank *s) { return s->pcm.get(); }
double ym2203_block_first(bank *s) { return double(s->blockFirst); }
// Checkpoint bytes live in ym2203_checkpoint, ym2203_checkpoint_capacity
// long. Save only after a render (no pending samples); returns the size.
// Load reads n bytes from the same buffer, only as the first call on a
// fresh bank, and fails closed unless every chip blob has the size this
// ymfm build saves.
uint8_t *ym2203_checkpoint(bank *s) { return s->checkpoint.data(); }
uint32_t ym2203_checkpoint_capacity(bank *s) {
  return static_cast<uint32_t>(s->checkpoint.size());
}
int32_t ym2203_save(bank *s) {
  if(s->error)return -STOPPED;
  if(s->pending)return s->stop(SAVE_INVALID);
  std::vector<uint8_t> out={'G','Y','M','1'};
  put(out,s->first,8);put(out,s->next,8);put(out,s->frontier,8);
  put(out,s->lastEvent,8);
  for(uint32_t c=0;c<s->chips;c++) {
    const auto blob=chip_bytes(s->chip_state[c].ym);
    put(out,blob.size(),4);
    out.insert(out.end(),blob.begin(),blob.end());
  }
  if(out.size()>s->checkpoint.size())return s->stop(SAVE_INVALID);
  std::copy(out.begin(),out.end(),s->checkpoint.begin());
  s->fresh=false;
  return static_cast<int32_t>(out.size());
}
int32_t ym2203_load(bank *s,uint32_t n) {
  if(s->error)return -STOPPED;
  const uint8_t *p=s->checkpoint.data();
  const size_t expected=s->chip_state_bytes;
  bool valid=s->fresh && n==s->checkpoint.size() && p[0]=='G' &&
    p[1]=='Y' && p[2]=='M' && p[3]=='1';
  for(uint32_t c=0;valid && c<s->chips;c++)
    valid=get(p+36+c*(4+expected),4)==expected;
  const uint64_t first=valid?get(p+4,8):0,next=valid?get(p+12,8):0,
    frontier=valid?get(p+20,8):0,lastEvent=valid?get(p+28,8):0;
  if(!valid || next<first || lastEvent<frontier)return s->stop(LOAD_INVALID);
  for(uint32_t c=0;c<s->chips;c++) {
    const uint8_t *at=p+40+c*(4+expected);
    std::vector<uint8_t> blob(at,at+expected);
    ymfm::ymfm_saved_state state(blob,false);
    s->chip_state[c].ym.save_restore(state);
  }
  s->first=first;s->next=next;s->frontier=frontier;s->lastEvent=lastEvent;
  s->fresh=false;
  return OK;
}
}
