/*
 * Test-only independent MC6809 instruction oracle.
 *
 * Compile with the unmodified, pinned elmerucr/mc6809 C++ library.
 * Not part of the runtime, product, or JS transpiler. No ROM is bundled.
 * The only host glue is a deterministic 64 KiB bus with exactly seven
 * source-PC-qualified board I/O sites observed in the operator's ROM.
 */
#include "mc6809.hpp"
#include <array>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

static constexpr const char *SOURCE_COMMIT =
    "5bad24375961418d6591491929aea1f4dc8cb90f";
struct Event {
    std::string kind;
    uint16_t pc;
    uint16_t addr;
    uint8_t value;
};
static std::string hex4(uint16_t n) {
    std::ostringstream s;
    s << "0x" << std::hex << std::setw(4) << std::setfill('0') << n;
    return s.str();
}
static uint32_t parseNum(const char *s) {
    size_t count = 0;
    unsigned long v=std::stoul(s,&count,0);
    if (count!=std::string(s).length() || v>0xfffffffful)
        throw std::runtime_error("Invalid numeric argument");
    return static_cast<uint32_t>(v);
}
static uint8_t randomByte(uint32_t &x) {
    x^=x<<13;
    x^=x>>17;
    x^=x<<5;
    return static_cast<uint8_t>(x&255);
}
class BoardCpu final : public mc6809 {
public:
    mutable std::array<uint8_t,65536> data{};
    std::array<uint8_t,65536> rom{};
    uint16_t entry=0, current_pc=0;
    uint32_t seed=0;
    mutable size_t nextIoRead=0;
    mutable std::vector<Event> trace;
    bool readOnlyRom=true;
    void init(uint16_t target,uint32_t randomSeed,uint16_t sp,
              const std::string &filename) {
        std::ifstream in(filename,std::ios::binary);
        if (!in.read(reinterpret_cast<char *>(rom.data()),rom.size()))
            throw std::runtime_error("Need exactly 65536 ROM bytes");
        char extra;
        if (in.read(&extra,1))
            throw std::runtime_error("ROM image longer than 65536 bytes");
        entry=target;
        seed=randomSeed;
        uint32_t x=seed;
        for (auto &byte:data) byte=randomByte(x);
        std::array<uint8_t,256> r{};
        for (auto &byte:r) byte=randomByte(x);
        r[9]=0;
        r[16]=static_cast<uint8_t>(entry>>8);
        r[17]=static_cast<uint8_t>(entry);
        r[24]=static_cast<uint8_t>(sp>>8);
        r[25]=static_cast<uint8_t>(sp);
        data[sp]=0x70;data[sp+1]=0x00;
        // reset reads the ROM reset vector before test-specific registers.
        reset();
        set_pc(entry);
        set_ac(r[0]);set_br(r[1]); // set_dr in this upstream version is buggy
        set_cc(r[8]);set_dp(r[9]);
        set_xr((r[18]<<8)|r[19]);set_yr((r[20]<<8)|r[21]);
        set_us((r[22]<<8)|r[23]);set_sp((r[24]<<8)|r[25]);
        baseline=data;
    }
    mutable std::array<uint8_t,65536> baseline{};
    uint8_t read8(uint16_t addr) const override {
        if (addr>=0x3000 && addr<0x4000) {
            if (entry==0x622c &&
                ((current_pc==0x622c && addr==0x3003 && nextIoRead==0) ||
                 (current_pc==0x6232 && addr==0x3004 && nextIoRead==1))) {
                uint8_t value=static_cast<uint8_t>((seed>>(nextIoRead*8))&255);
                trace.push_back({"read",current_pc,addr,value});
                ++nextIoRead;
                return value;
            }
            throw std::runtime_error("Native CPU accessed unapproved I/O read "+
                                     hex4(addr)+" from "+hex4(current_pc));
        }
        if (addr>=0x4000) return rom[addr];
        return data[addr];
    }
    void write8(uint16_t addr,uint8_t value) const override {
        if (addr>=0x3000 && addr<0x4000) {
            bool allowed = entry==0x6755 &&
                ((current_pc==0x6759 && addr==0x3d00) ||
                 (current_pc==0x675e && addr==0x3b09) ||
                 (current_pc==0x6761 && addr==0x3b08) ||
                 (current_pc==0x676b && addr==0x3b0b) ||
                 (current_pc==0x676e && addr==0x3b0a));
            if (!allowed)
                throw std::runtime_error("Native CPU unapproved I/O write "+
                                         hex4(addr)+" from "+hex4(current_pc));
            trace.push_back({"write",current_pc,addr,value});
            return;
        }
        if (addr>=0x4000)
            throw std::runtime_error("Native CPU attempted ROM write");
        data[addr]=value;
    }
};
int main(int argc,char **argv) {
    try {
        if (argc!=5)
            throw std::runtime_error(
                "Usage: mc6809-reference <out/gngb-flat.bin> <entry> <seed> <stack>");
        uint32_t e=parseNum(argv[2]),seed=parseNum(argv[3]),s=parseNum(argv[4]);
        if ((e!=0x622c && e!=0x6755) || s<0x100 || s>0x2ffc)
            throw std::runtime_error("Unsupported entry or stack contract");
        BoardCpu cpu;
        cpu.init(static_cast<uint16_t>(e),seed,static_cast<uint16_t>(s),argv[1]);
        const uint16_t expectedRts=e==0x622c?0x6238:0x6771;
        uint32_t steps=0;
        bool rtsSeen=false;
        while(cpu.get_pc()!=0x7000 && steps<1000) {
            cpu.current_pc=cpu.get_pc();
            if (cpu.current_pc==expectedRts) rtsSeen=true;
            cpu.execute();
            ++steps;
        }
        if (!rtsSeen || cpu.get_pc()!=0x7000)
            throw std::runtime_error("Native CPU did not execute expected RTS to 0x7000");
        const size_t expectedEvents=e==0x622c?2:5;
        if (cpu.trace.size()!=expectedEvents || cpu.nextIoRead!=(e==0x622c?2u:0u))
            throw std::runtime_error("Native CPU board event count mismatch");
        // NOTE stdout is not pure JSON because upstream cpu.reset() and
        // destructor print diagnostic lines. JSON is between these markers.
        std::cout << "GNG_NATIVE_BEGIN\n{";
        std::cout << "\"schema\":\"gng.mc6809-oracle.v1\","
                  << "\"provider\":\"elmerucr/mc6809\","
                  << "\"provider_commit\":\""<< SOURCE_COMMIT <<"\","
                  << "\"entry\":\""<<hex4(static_cast<uint16_t>(e))<<"\","
                  << "\"seed\":"<<seed<<",\"stack\":"<<s<<","
                  << "\"return_address\":28672,"
                  << "\"source_rts\":"<<expectedRts<<","
                  << "\"steps\":"<<steps<<",\"registers\":{";
        std::cout << "\"A\":"<<(int)cpu.get_ac()<<",\"B\":"<<(int)cpu.get_br()
                  <<",\"CC\":"<<(int)cpu.get_cc()<<",\"DP\":"<<(int)cpu.get_dp()
                  <<",\"X\":"<<cpu.get_xr()<<",\"Y\":"<<cpu.get_yr()
                  <<",\"U\":"<<cpu.get_us()<<",\"S\":"<<cpu.get_sp()
                  <<",\"PC\":"<<cpu.get_pc()<<"},\"ioTrace\":[";
        for(size_t i=0;i<cpu.trace.size();++i){
            auto &v=cpu.trace[i];
            if(i)std::cout<<",";
            std::cout<<"{\"kind\":\""<<v.kind<<"\",\"pc\":"<<v.pc
                     <<",\"addr\":"<<v.addr<<",\"size\":1,\"value\":"
                     <<(int)v.value<<"}";
        }
        std::cout<<"],\"ramChanges\":[";
        bool first=true;
        for(size_t i=0;i<0x3000;++i) {
            if(cpu.baseline[i]!=cpu.data[i]){
                if(!first)std::cout<<",";
                first=false;
                std::cout<<"{\"addr\":"<<i<<",\"before\":"
                         <<(int)cpu.baseline[i]<<",\"after\":"
                         <<(int)cpu.data[i]<<"}";
            }
        }
        std::cout<<"]}\nGNG_NATIVE_END\n";
        return 0;
    } catch(const std::exception &err) {
        std::cerr<<"GNG_NATIVE_ORACLE=BLOCKED "<<err.what()<<'\n';
        return 1;
    }
}
