-- V3.B3 oracle: replay a B3 input tape in MAME's gngb and dump the frame
-- records (same layout as R3.5.B2.T4.3 / the AOT runtime snapshot) for the
-- requested record indices. Only the tape's ioport fields are written;
-- CPU state and memory are never touched. Output is private (out/).
-- Record index i = i-th machine frame notifier (VBLANK start, IRQ of that
-- frame not yet delivered), matching AOT record i. An input event at AOT
-- cycle i*25152 is applied at notifier i-1: calibrated on titleCoinStart
-- (shift 0 lags one frame at RAM 0x42; shift -1 matches every byte).
local dir = assert(os.getenv("GNG_B3_ORACLE_DIR"), "V3_B3_ORACLE_DIR_MISSING")
local tape = os.getenv("GNG_B3_ORACLE_TAPE") or ""
-- Calibration override only; -1 is the measured alignment (see above).
local shift = tonumber(os.getenv("GNG_B3_ORACLE_SHIFT") or "-1")
local want_s = assert(os.getenv("GNG_B3_ORACLE_FRAMES"), "V3_B3_ORACLE_FRAMES_MISSING")
local machine = manager.machine
assert(machine.system and machine.system.name == "gngb", "V3_B3_ORACLE_NOT_GNGB")
local screen = assert(machine.screens[":screen"], "V3_B3_ORACLE_SCREEN")
local cpu = assert(machine.devices[":maincpu"], "V3_B3_ORACLE_CPU")
local space = assert(cpu.spaces["program"], "V3_B3_ORACLE_SPACE")
local palette = assert(machine.palettes[":palette"], "V3_B3_ORACLE_PALETTE")
local shares = machine.memory.shares
local ports = machine.ioport.ports
local FIELDS = {
    coin1 = {":SYSTEM", "Coin 1"}, start1 = {":SYSTEM", "1 Player Start"},
    ["p1.right"] = {":P1", "P1 Right"}, ["p1.left"] = {":P1", "P1 Left"},
    ["p1.up"] = {":P1", "P1 Up"}, ["p1.down"] = {":P1", "P1 Down"},
    ["p1.button1"] = {":P1", "P1 Button 1"}, ["p1.button2"] = {":P1", "P1 Button 2"},
}
local function field(name)
    local spec = assert(FIELDS[name], "V3_B3_ORACLE_CONTROL_" .. name)
    local port = assert(ports[spec[1]], "V3_B3_ORACLE_PORT_" .. spec[1])
    return assert(port.fields[spec[2]], "V3_B3_ORACLE_FIELD_" .. spec[2])
end
local events = {}
for f, c, p in tape:gmatch("(%d+):([%w%.]+):([01])") do
    local at = tonumber(f) + shift
    local list = events[at] or {}
    list[#list + 1] = {field(c), tonumber(p)}
    events[at] = list
end
local want, last = {}, 0
for f in want_s:gmatch("%d+") do
    want[tonumber(f)] = true
    if tonumber(f) > last then last = tonumber(f) end
end
local function share(tag) return assert(shares[tag], "V3_B3_ORACLE_SHARE_" .. tag) end
local sprites, fg, bg = share(":spriteram"), share(":fgvideoram"), share(":bgvideoram")
local pal_ext, pal = share(":palette_ext"), share(":palette")
local function readshare(s)
    local out = {}
    for i = 0, s.size - 1 do out[#out + 1] = string.char(s:read_u8(i)) end
    return table.concat(out)
end
local sprite_buffer = nil
gng_b3_dma_tap = space:install_write_tap(0x3c00, 0x3c00, "gng-b3-dma",
    function(address, data, mask) sprite_buffer = readshare(sprites); return data end)
local out = assert(io.open(dir .. "/frames.bin", "wb"), "V3_B3_ORACLE_OPEN")
local index_file = assert(io.open(dir .. "/frames.txt", "wb"), "V3_B3_ORACLE_OPEN_IDX")
local count, first = 0, nil
gng_b3_sub = emu.add_machine_frame_notifier(function()
    local frame = screen:frame_number()
    if first == nil then first = frame end
    count = count + 1
    assert(frame == first + count - 1, "V3_B3_ORACLE_FRAME_SEQUENCE")
    if want[count] then
        local rgba = {}
        for i = 0, 255 do
            local c = palette:pen_color(i)
            rgba[#rgba + 1] = string.char((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255)
        end
        local blob = space:read_range(0x0000, 0x1dff, 8) .. readshare(sprites) ..
            (sprite_buffer or string.rep("\0", 0x200)) .. readshare(fg) .. readshare(bg) ..
            readshare(pal_ext) .. readshare(pal) .. table.concat(rgba)
        assert(#blob == 0x3800, "V3_B3_ORACLE_RECORD_SIZE")
        out:write(blob)
        index_file:write(count .. "\n")
    end
    for _, ev in ipairs(events[count] or {}) do ev[1]:set_value(ev[2]) end
    if count >= last then
        out:close(); index_file:close()
        print("V3_B3_ORACLE_LUA=RECORDED")
        machine:exit()
    end
end)
