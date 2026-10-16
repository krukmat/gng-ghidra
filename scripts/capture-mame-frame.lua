-- Test-only MAME reference capture for Ghosts 'n Goblins.
-- Run with -autoboot_script from scripts/capture_real_frame.py.
-- No ROM or snapshot is committed. This does NOT run in product runtime.
--
-- Captures: exact FG/BG shares, DMA-buffered sprite RAM, video scroll write
-- taps, 256 palette RGB colours, and native MAME PNG in same frame callback.
-- Hardware: MAME src/mame/capcom/gng.cpp
--
-- IMPORTANT: MAME's Lua API changes between versions; if this script fails
-- it MUST not fabricate a snapshot or fall back to random fixture memory.
local dir = assert(os.getenv("GNG_CAPTURE_DIR"), "missing GNG_CAPTURE_DIR")
local target = tonumber(os.getenv("GNG_CAPTURE_FRAME") or "600")
assert(target and target >= 2 and target <= 7200 and target % 1 == 0,
    "frame must be integer in 2..7200")

local machine = manager.machine
local system = machine.system
assert(system and (system.name == "gngb" or system.name == "gng"),
    "expected gngb/gng hardware, not " .. tostring(system and system.name))

local screen = assert(machine.screens[":screen"], "MAME :screen missing")
local cpu = assert(machine.devices[":maincpu"], "MAME :maincpu missing")
local space = assert(cpu.spaces["program"], "maincpu program space missing")
local shares = machine.memory.shares
local fg = assert(shares[":fgvideoram"], "required :fgvideoram share missing")
local bg = assert(shares[":bgvideoram"], "required :bgvideoram share missing")
local sprites = assert(shares[":spriteram"], "required :spriteram share missing")
local palette = assert(machine.palettes[":palette"], "required palette device missing")
assert(fg.size == 0x800 and bg.size == 0x800 and sprites.size == 0x200,
       "Unexpected memory share sizes")
assert(palette.entries >= 256, "Expected 256 palette entries")

local scroll = {0, 0, 0, 0}
local sprite_buffer = nil
local dma_count = 0
local completed = false

local function readshare(share, len)
    local data = {}
    for i = 0, len - 1 do
        data[#data + 1] = string.char(share:read_u8(i))
    end
    return table.concat(data)
end

local function dumpbytes(path, data)
    local f, err = io.open(path, "wb")
    assert(f, "failed to open " .. path .. ": " .. tostring(err))
    assert(f:write(data), "failed to write " .. path)
    assert(f:close(), "failed to close " .. path)
end

-- install_write_tap callback sees the CPU address, data and mask and must
-- return original data unmodified. Retain subscriptions until process exits.
local scroll_tap = space:install_write_tap(
    0x3b08, 0x3b0b, "gng-capture-scroll",
    function(address, data, mask)
        if address >= 0x3b08 and address <= 0x3b0b then
            scroll[address - 0x3b08 + 1] = data & 0xff
        end
        return data
    end)
local dma_tap = space:install_write_tap(
    0x3c00, 0x3c00, "gng-capture-buffered-sprites",
    function(address, data, mask)
        -- Sprite DMA stores a COPY of source RAM, not a view of mutable RAM.
        sprite_buffer = readshare(sprites, 0x200)
        dma_count = dma_count + 1
        return data
    end)
assert(scroll_tap and dma_tap, "MAME write-tap installation failed")

local function snapshot()
    if completed or screen.frame_number < target then return end
    -- A missing DMA is not equivalent to the current source RAM.
    assert(sprite_buffer and dma_count > 0,
        "No observed sprite DMA at 0x3c00; choose a later capture frame")

    local pal = {}
    for i = 0, 255 do
        local rgb = palette:pen_color(i)
        pal[#pal + 1] = string.char(
            (rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255)
    end
    dumpbytes(dir .. "/foreground.bin", readshare(fg, 0x800))
    dumpbytes(dir .. "/background.bin", readshare(bg, 0x800))
    dumpbytes(dir .. "/sprites-buffered.bin", sprite_buffer)
    dumpbytes(dir .. "/palette-rgba.bin", table.concat(pal))

    -- This PNG is produced by independent MAME's video pipeline.
    -- The JS renderer will be compared against it, not substituted for it.
    local snaperr = screen:snapshot(dir .. "/reference.png")
    assert(snaperr == nil, "MAME could not write screen snapshot: " ..
           tostring(snaperr))
    local x = scroll[1] + scroll[2] * 256
    local y = scroll[3] + scroll[4] * 256
    local pc = cpu.state["PC"] and cpu.state["PC"].value or nil
    local pc_json = pc and tostring(pc) or "null"
    dumpbytes(dir .. "/state.json", string.format(
        '{"schema":"gng.mame-video-state.v1",' ..
        '"driver":"%s","frame":%d,"dma_count":%d,' ..
        '"scroll_x":%d,"scroll_y":%d,' ..
        '"scroll_bytes":[%d,%d,%d,%d],"pc":%s,' ..
        '"source":"MAME independent native frame, not translated JS",' ..
        '"sprite_buffer_source":"CPU write tap 0x3c00"}\n',
        system.name, screen.frame_number, dma_count,
        x, y, scroll[1], scroll[2], scroll[3], scroll[4], pc_json))
    completed = true
    print("GNG_MAME_REFERENCE=CAPTURED frame=" .. screen.frame_number ..
        " dma=" .. dma_count .. " scroll_x=" .. x .. " scroll_y=" .. y)
    machine:exit()
end

-- The machine frame notifier is a reference capture, not a product loop.
local subscription = emu.add_machine_frame_notifier(snapshot)
assert(subscription, "MAME machine frame notifier unavailable")
