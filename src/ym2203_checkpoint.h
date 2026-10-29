// Checkpoint of the dual-YM2203 synthesizer, shared by the native stream
// (web, audio_ym2203_lab --stream) and the WebAssembly worker (Android):
// the same bytes on both builds. Layout, little-endian:
//   "GYM1", u64 first, next, frontier, lastEvent, then per chip u32 size +
//   ymfm save_restore bytes. Valid only with no pending samples (after U).
#pragma once
#include "ymfm_opn.h"
#include <cstddef>
#include <cstdint>
#include <vector>

namespace ymck {
struct timeline { uint64_t first=0,next=0,frontier=0,lastEvent=0; };
inline void put(std::vector<uint8_t> &out,uint64_t x,int bytes) {
  for(int i=0;i<bytes;i++)out.push_back(static_cast<uint8_t>(x>>(8*i)));
}
inline uint64_t get(const uint8_t *p,int bytes) {
  uint64_t x=0;
  for(int i=0;i<bytes;i++)x|=uint64_t(p[i])<<(8*i);
  return x;
}
inline std::vector<uint8_t> chip_bytes(ymfm::ym2203 &chip) {
  std::vector<uint8_t> blob;
  ymfm::ymfm_saved_state state(blob,true);
  chip.save_restore(state);
  return blob;
}
inline std::vector<uint8_t> save(ymfm::ym2203 &a,ymfm::ym2203 &b,
    const timeline &t) {
  std::vector<uint8_t> out={'G','Y','M','1'};
  put(out,t.first,8);put(out,t.next,8);put(out,t.frontier,8);
  put(out,t.lastEvent,8);
  for(ymfm::ym2203 *chip:{&a,&b}) {
    const auto blob=chip_bytes(*chip);
    put(out,blob.size(),4);
    out.insert(out.end(),blob.begin(),blob.end());
  }
  return out;
}
// Fails closed (false, chips untouched) unless each chip blob has exactly
// the size this ymfm build saves; restores both chips and the timeline.
inline bool load(ymfm::ym2203 &a,ymfm::ym2203 &b,timeline &t,
    const uint8_t *p,size_t n) {
  const size_t expected=chip_bytes(a).size();
  if(n!=4+32+2*(4+expected) || p[0]!='G' || p[1]!='Y' || p[2]!='M' ||
     p[3]!='1')return false;
  for(int i=0;i<2;i++)
    if(get(p+36+i*(4+expected),4)!=expected)return false;
  t={get(p+4,8),get(p+12,8),get(p+20,8),get(p+28,8)};
  if(t.next<t.first || t.lastEvent<t.frontier)return false;
  int i=0;
  for(ymfm::ym2203 *chip:{&a,&b}) {
    const uint8_t *at=p+40+i*(4+expected);
    std::vector<uint8_t> blob(at,at+expected);
    ymfm::ymfm_saved_state state(blob,false);
    chip->save_restore(state);
    i++;
  }
  return true;
}
}
