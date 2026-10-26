-- R3.5.B2.T4.3: private per-frame reference from ONE cold-boot MAME run of
-- the instrumented gngb binary. Native IRQ/SYNC events go to -oslog; this
-- script only records memory and video for the first N frames.
-- It never writes CPU state, memory or inputs: a passive reference only.
-- Every share, tap and API used here was checked in the MAME 0.289 source.
-- Boundary (screen.cpp vblank_begin): the frame notifier runs BEFORE the
-- screen callbacks that assert the MC6809 VBLANK IRQ (irq0_line_hold), so
-- each record is the state at VBLANK start with that frame's IRQ not yet
-- delivered. frame_number increments at vblank_end, so the first record
-- normally has frame 0; it is recorded, not assumed.
local dir = assert(os.getenv("GNG_T43_DIR"), "R35_T43_DIR_MISSING")
local last = tonumber(os.getenv("GNG_T43_FRAMES") or "")
assert(last and last >= 2 and last <= 3600 and last % 1 == 0, "R35_T43_FRAMES_INVALID")

local machine = manager.machine
assert(machine.system and machine.system.name == "gngb", "R35_T43_DRIVER_NOT_GNGB")
local screen = assert(machine.screens[":screen"], "R35_T43_SCREEN_MISSING")
local cpu = assert(machine.devices[":maincpu"], "R35_T43_MAINCPU_MISSING")
local space = assert(cpu.spaces["program"], "R35_T43_PROGRAM_SPACE_MISSING")
local palette = assert(machine.palettes[":palette"], "R35_T43_PALETTE_MISSING")
local shares = machine.memory.shares
local function share(tag, size)
    local s = assert(shares[tag], "R35_T43_SHARE_MISSING")
    assert(s.size == size, "R35_T43_SHARE_SIZE")
    return s
end
-- gng.cpp gng_map: 0x1e00 spriteram, 0x2000 fg, 0x2800 bg,
-- 0x3800 palette_ext (write8_ext), 0x3900 palette (write8).
local sprites = share(":spriteram", 0x200)
local fg = share(":fgvideoram", 0x800)
local bg = share(":bgvideoram", 0x800)
local pal_ext = share(":palette_ext", 0x100)
local pal = share(":palette", 0x100)
assert(palette.entries >= 256, "R35_T43_PALETTE_ENTRIES")

local function readshare(s)
    local out = {}
    for i = 0, s.size - 1 do out[#out + 1] = string.char(s:read_u8(i)) end
    return table.concat(out)
end

-- Write taps observe and return data unchanged. Counts are per frame so a
-- runtime can be compared write-for-write at each frame boundary.
local scroll = {nil, nil, nil, nil}
local sprite_buffer = nil
local writes = {dma = 0, scroll = 0, bank = 0, latch = 0}
local bank = nil
local latch = {}
gng_t43_scroll_tap = space:install_write_tap(0x3b08, 0x3b0b, "gng-t43-scroll",
    function(address, data, mask)
        scroll[address - 0x3b08 + 1] = data & 0xff
        writes.scroll = writes.scroll + 1
        return data
    end)
gng_t43_dma_tap = space:install_write_tap(0x3c00, 0x3c00, "gng-t43-dma",
    function(address, data, mask)
        -- The device copies spriteram at this write; keep that copy.
        sprite_buffer = readshare(sprites)
        writes.dma = writes.dma + 1
        return data
    end)
gng_t43_bank_tap = space:install_write_tap(0x3e00, 0x3e00, "gng-t43-bank",
    function(address, data, mask)
        bank = data & 0xff
        writes.bank = writes.bank + 1
        return data
    end)
gng_t43_latch_tap = space:install_write_tap(0x3d00, 0x3d07, "gng-t43-latch",
    function(address, data, mask)
        latch[address - 0x3d00] = data & 0xff
        writes.latch = writes.latch + 1
        return data
    end)
assert(gng_t43_scroll_tap and gng_t43_dma_tap and gng_t43_bank_tap and
       gng_t43_latch_tap, "R35_T43_TAP_INSTALL_FAILED")

local RECORD = 0x1e00 + 0x200 + 0x200 + 0x800 + 0x800 + 0x100 + 0x100 + 0x400
local memfile = assert(io.open(dir .. "/frames.bin", "wb"), "R35_T43_FRAMES_BIN_OPEN")
local metafile = assert(io.open(dir .. "/frames.jsonl", "wb"), "R35_T43_FRAMES_JSONL_OPEN")
local function n(v) return v == nil and "null" or tostring(v) end
local recorded = 0
local first_frame = nil

local function record(frame)
    local ram = space:read_range(0x0000, 0x1dff, 8)
    assert(#ram == 0x1e00, "R35_T43_RAM_READ_SIZE")
    local rgba = {}
    for i = 0, 255 do
        local c = palette:pen_color(i)
        rgba[#rgba + 1] = string.char((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255)
    end
    local buffered = sprite_buffer or string.rep("\0", 0x200)
    local blob = ram .. readshare(sprites) .. buffered .. readshare(fg) ..
        readshare(bg) .. readshare(pal_ext) .. readshare(pal) .. table.concat(rgba)
    assert(#blob == RECORD, "R35_T43_RECORD_SIZE")
    assert(memfile:write(blob), "R35_T43_FRAMES_BIN_WRITE")
    local err = screen:snapshot(string.format("%s/png/%04d.png", dir, frame))
    assert(err == nil, "R35_T43_SNAPSHOT_FAILED")
    local t = machine.time
    local l = {}
    for i = 0, 7 do l[#l + 1] = n(latch[i]) end
    assert(metafile:write(string.format(
        '{"index":%d,"frame":%d,"time_s":%d,"time_as":%s,"sprite_buffer_valid":%s,' ..
        '"dma_writes":%d,"scroll_writes":%d,"bank_writes":%d,"latch_writes":%d,' ..
        '"scroll":[%s,%s,%s,%s],"bank":%s,"latch":[%s]}\n',
        recorded + 1, frame, t.seconds, string.format("%d", t.attoseconds),
        sprite_buffer and "true" or "false", writes.dma, writes.scroll,
        writes.bank, writes.latch, n(scroll[1]), n(scroll[2]), n(scroll[3]),
        n(scroll[4]), n(bank), table.concat(l, ","))), "R35_T43_FRAMES_JSONL_WRITE")
    writes = {dma = 0, scroll = 0, bank = 0, latch = 0}
    recorded = recorded + 1
end

gng_t43_frame_subscription = emu.add_machine_frame_notifier(function()
    local frame = screen.frame_number
    if recorded >= last then return end
    -- Consecutive frames from the first notifier; a gap is a failed capture.
    if recorded == 0 then first_frame = frame end
    assert(type(frame) == "number" and frame == first_frame + recorded,
           "R35_T43_FRAME_SEQUENCE")
    record(frame)
    if recorded == last then
        assert(memfile:close() and metafile:close(), "R35_T43_CLOSE_FAILED")
        print("R35_T43_LUA=FRAMES_RECORDED")
        machine:exit()
    end
end)
assert(gng_t43_frame_subscription, "R35_T43_FRAME_NOTIFIER_MISSING")
