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
local capture_attempted = false
local keep_running = os.getenv("GNG_CAPTURE_KEEP_RUNNING") == "1"

-- A minimal fixed-frame input driver inspired by the Pyjamada QA bot.
-- It controls only MAME test inputs, not the generated JS game engine.
-- All input windows are strictly validated by Python before launch.
local bot_wire = os.getenv("GNG_BOT_EVENTS")
local bot_sha = os.getenv("GNG_BOT_SHA256")
local bot_events = {}
local bot_fields = nil
local bot_active_frame_actions = 0
local bot_effective_coin_frames = 0
local bot_effective_start_frames = 0

-- Real MAME 0.287 gngb field names, verified in blackbox_mame_game_abstraction:
-- scripts/mame_autoboot.lua (not numerical-mask lookups).
local INPUTS = {
    coin={":SYSTEM","Coin 1"}, start={":SYSTEM","1 Player Start"},
    right={":P1","P1 Right"}, left={":P1","P1 Left"},
    down={":P1","P1 Down"}, up={":P1","P1 Up"},
    attack={":P1","P1 Button 1"}, jump={":P1","P1 Button 2"}
}
if bot_wire then
    assert(bot_sha and bot_sha:match("^[0-9a-f]+$") and #bot_sha == 64,
           "missing/corrupt bot schedule SHA-256")
    assert(#bot_wire > 0 and #bot_wire < 8192, "invalid bot input schedule")
    for token in bot_wire:gmatch("[^;]+") do
        local a,b,action = token:match("^(%d+):(%d+):([a-z]+)$")
        a,b = tonumber(a),tonumber(b)
        assert(a and b and a >= 0 and a < b and b <= target and INPUTS[action],
               "invalid bot action/frame window: " .. token)
        bot_events[#bot_events+1] = {a=a,b=b,action=action}
    end
    assert(#bot_events > 0 and #bot_events <= 100, "invalid bot event count")
end

local function initialize_bot_fields()
    if bot_fields or not bot_wire then return end
    local resolved = {}
    for action, locator in pairs(INPUTS) do
        local port = assert(machine.ioport.ports[locator[1]],
                            "MAME I/O port missing for " .. action)
        local field = assert(port.fields[locator[2]],
                             "MAME input field missing for " .. action)
        resolved[action] = {field=field,port=port,mask=field.mask,
                            defvalue=field.defvalue}
    end
    bot_fields = resolved
    print("GNG_BOT_FIELDS=RESOLVED_MAME_NAMES")
end

local function step_bot(frame)
    if not bot_wire then return end
    initialize_bot_fields()
    for _, entry in pairs(bot_fields) do entry.field:clear_value() end
    for _, event in ipairs(bot_events) do
        if frame >= event.a and frame < event.b then
            bot_fields[event.action].field:set_value(1)
            bot_active_frame_actions = bot_active_frame_actions + 1
        end
    end
    -- Ground truth from MAME input ports, not only from our requested schedule.
    -- Mirrors blackbox's (read ~ defvalue) & mask active-state contract.
    for action, entry in pairs(bot_fields) do
        local value = entry.port:read()
        if ((value ~ entry.defvalue) & entry.mask) ~= 0 then
            if action == "coin" then bot_effective_coin_frames = bot_effective_coin_frames + 1 end
            if action == "start" then bot_effective_start_frames = bot_effective_start_frames + 1 end
        end
    end
end


-- Private screenshots at boot boundaries. This is a diagnostic, not a game-start proof.
local bot_checkpoints = {920, 980, 1060, 1300, 1510, 1660}
local bot_checkpoint_count = 0
local function capture_checkpoint(frame)
    if not bot_wire then return end
    for _, requested in ipairs(bot_checkpoints) do
        if frame == requested and requested < target then
            local filename = string.format("%s/checkpoints/frame-%04d.png", dir, frame)
            local err = screen:snapshot(filename)
            assert(err == nil, "MAME boot checkpoint screenshot failed: " .. tostring(err))
            bot_checkpoint_count = bot_checkpoint_count + 1
            print("GNG_BOT_CHECKPOINT=frame_" .. frame)
            return
        end
    end
end

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
-- Keep pass-through tap handles alive across frame callbacks; local
-- autoboot chunk variables can be garbage-collected before gameplay.
gng_capture_scroll_tap = space:install_write_tap(
    0x3b08, 0x3b0b, "gng-capture-scroll",
    function(address, data, mask)
        if address >= 0x3b08 and address <= 0x3b0b then
            scroll[address - 0x3b08 + 1] = data & 0xff
        end
        return data
    end)
gng_capture_dma_tap = space:install_write_tap(
    0x3c00, 0x3c00, "gng-capture-buffered-sprites",
    function(address, data, mask)
        -- Sprite DMA stores a COPY of source RAM, not a view of mutable RAM.
        sprite_buffer = readshare(sprites, 0x200)
        dma_count = dma_count + 1
        return data
    end)
assert(gng_capture_scroll_tap and gng_capture_dma_tap, "MAME write-tap installation failed")

local function snapshot()
    if completed or capture_attempted or screen:frame_number() < target then return end
    capture_attempted = true
    -- Missing DMA means no authenticated buffered sprite state; never fake it
    -- with the unbuffered CPU RAM. In Blackbox addon mode, fail only the video
    -- capture and let the upstream bot finish and write its input timeline.
    if not sprite_buffer or dma_count <= 0 then
        print("GNG_R0_VIDEO_CAPTURE=BLOCKED_DMA_NOT_OBSERVED frame=" ..
              screen:frame_number() .. " dma=" .. dma_count)
        if keep_running then
            local err = screen:snapshot(dir .. "/reference.png")
            if err ~= nil then
                print("GNG_R0_VIDEO_SCREENSHOT=FAILED " .. tostring(err))
            else
                print("GNG_R0_VIDEO_SCREENSHOT=UNVERIFIED_NO_DMA")
            end
            completed = true
            return
        end
        error("No observed sprite DMA at 0x3c00; reference frame not complete")
    end

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
    local replay_json = "null"
    if bot_wire then
        assert(bot_active_frame_actions > 0, "bot schedule did not activate inputs")
        assert(bot_effective_coin_frames > 0, "Coin not observed on MAME input port")
        assert(bot_effective_start_frames > 0, "Start not observed on MAME input port")
        assert(bot_checkpoint_count == #bot_checkpoints, "Missing MAME boot checkpoints")
        replay_json = string.format(
            '{"schema":"gng.mame-input-replay.v1","sha256":"%s",' ..
            '"events":%d,"active_frame_actions":%d,' ..
            '"effective_coin_frames":%d,"effective_start_frames":%d}',
            bot_sha, #bot_events, bot_active_frame_actions,
            bot_effective_coin_frames, bot_effective_start_frames)
    end
    dumpbytes(dir .. "/state.json", string.format(
        '{"schema":"gng.mame-video-state.v1",' ..
        '"driver":"%s","frame":%d,"dma_count":%d,' ..
        '"scroll_x":%d,"scroll_y":%d,' ..
        '"scroll_bytes":[%d,%d,%d,%d],"pc":%s,' ..
        '"input_replay":%s,' ..
        '"source":"MAME independent native frame, not translated JS",' ..
        '"sprite_buffer_source":"CPU write tap 0x3c00"}\n',
        system.name, screen:frame_number(), dma_count,
        x, y, scroll[1], scroll[2], scroll[3], scroll[4], pc_json,
        replay_json))
    completed = true
    print("GNG_MAME_REFERENCE=CAPTURED frame=" .. screen:frame_number() ..
        " dma=" .. dma_count .. " scroll_x=" .. x .. " scroll_y=" .. y)
    if not keep_running then machine:exit() end
end

-- The machine frame notifier is a reference capture, not a product loop.
gng_capture_frame_subscription = emu.add_machine_frame_notifier(function()
    step_bot(screen:frame_number())
    capture_checkpoint(screen:frame_number())
    snapshot()
end)
assert(gng_capture_frame_subscription, "MAME machine frame notifier unavailable")
