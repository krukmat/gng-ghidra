// G5 lab-only YM2203 renderer: event-driven FM+PSG, not recorded audio.
// Reads private, timestamped MAME YM register writes via a converted TSV.
// Z80 and AudioWorklet integration are deliberately NOT implemented here.
#include "ymfm_opn.h"
#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr uint64_t master_hz=12000000;
constexpr uint32_t chip_hz=1500000;
constexpr uint32_t sample_hz=chip_hz/24; // OPN_FIDELITY_MIN = 62500 Hz
constexpr uint64_t ticks_per_sample=master_hz/sample_hz; // 192 ticks

class lab_interface : public ymfm::ymfm_interface {
  // No timer/IRQ interactions claimed. MAME has separate native timing.
};
struct write { uint64_t tick; uint32_t addr, value; };
void le16(std::ostream &out, uint16_t x) {
  const char b[2]={static_cast<char>(x),static_cast<char>(x>>8)};
  out.write(b,2);
}
void le32(std::ostream &out, uint32_t x) {
  le16(out,static_cast<uint16_t>(x));le16(out,static_cast<uint16_t>(x>>16));
}
std::vector<write> read_events(const char *file) {
  std::ifstream in(file);
  if(!in) throw std::runtime_error("AUDIO_EVENT_TAPE_MISSING");
  std::vector<write> rows;
  write e{};
  uint64_t prior=0;
  while(in >> e.tick >> e.addr >> e.value) {
    if(e.tick<prior || e.addr<0xe000 || e.addr>0xe003 ||
       e.value>255 || rows.size()>=200000)
      throw std::runtime_error("AUDIO_EVENT_TAPE_INVALID");
    rows.push_back(e); prior=e.tick;
  }
  if(!in.eof() || rows.empty())
    throw std::runtime_error("AUDIO_EVENT_TAPE_INVALID");
  return rows;
}
int16_t mix(ymfm::ym2203 &a,ymfm::ym2203 &b) {
  ymfm::ym2203::output_data x{},y{};
  a.generate(&x);b.generate(&y);
  // MAME gng.cpp mixer route gains: FM, SSG 1/2=0.4; SSG 3=0.2.
  // Amplitude calibration and parity remain native acceptance gates.
  double signal=0;
  for(int i=0;i<4;i++)
    signal+=(i==3 ? 0.2 : 0.4)*double(x.data[i]+y.data[i]);
  return static_cast<int16_t>(
    std::clamp(static_cast<int32_t>(signal),-32768,32767));
}
}
int main(int argc,char **argv) {
  if(argc!=4) {
    std::cerr<<"Usage: audio_ym2203_lab <events.tsv> <private.wav> <duration_ms 1..30000>\n";
    return 2;
  }
  try {
    const unsigned long duration=std::stoul(argv[3]);
    if(duration<1 || duration>30000)
      throw std::runtime_error("AUDIO_DURATION_INVALID");
    const auto rows=read_events(argv[1]);
    const uint64_t end_tick=master_hz*duration/1000;
    if(rows.back().tick>end_tick)
      throw std::runtime_error("AUDIO_DURATION_TOO_SHORT");
    const uint32_t samples=static_cast<uint32_t>(sample_hz*duration/1000);
    std::ofstream out(argv[2],std::ios::binary);
    if(!out)throw std::runtime_error("AUDIO_WAV_OPEN_FAILED");
    out.write("RIFF",4);le32(out,36+samples*2);
    out.write("WAVEfmt ",8);le32(out,16);le16(out,1);le16(out,1);
    le32(out,sample_hz);le32(out,sample_hz*2);le16(out,2);le16(out,16);
    out.write("data",4);le32(out,samples*2);
    lab_interface intf0,intf1;
    ymfm::ym2203 ym0(intf0),ym1(intf1);
    ym0.set_fidelity(ymfm::OPN_FIDELITY_MIN);
    ym1.set_fidelity(ymfm::OPN_FIDELITY_MIN);
    ym0.reset();ym1.reset();
    size_t pos=0;
    for(uint32_t index=0;index<samples;index++) {
      const uint64_t tick=uint64_t(index)*ticks_per_sample;
      while(pos<rows.size() && rows[pos].tick<=tick) {
        const auto &e=rows[pos++];
        const uint32_t offset=e.addr-0xe000;
        (offset<2 ? ym0 : ym1).write(offset&1,e.value);
      }
      le16(out,static_cast<uint16_t>(mix(ym0,ym1)));
    }
    if(!out || pos!=rows.size())
      throw std::runtime_error("AUDIO_WAV_UNCONSUMED_OR_IO_ERROR");
    std::cout<<"GNG_AUDIO_YM_LAB=PCM_FROM_NATIVE_YM_EVENTS_ONLY"
             <<" sample_hz="<<sample_hz<<" samples="<<samples
             <<" consumed="<<pos<<"\n";
    return 0;
  }catch(const std::exception &e) {
    std::cerr<<"GNG_AUDIO_YM_LAB=STOP "<<e.what()<<"\n";
    return 2;
  }
}
