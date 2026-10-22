-- R2.2.A: observe real MAME instruction trace readiness and sampled MMIO.
-- NEVER a complete CPU/oracle trace. Never reconstruct instruction state here.
-- Run ONLY in an independent, private gngb MAME test process.
-- -autoboot_script can be re-entered on a MAME soft reset.  The Lua VM
-- retains callback subscriptions; never open/truncate a second TSV or
-- register duplicate callbacks for one diagnostic process.
if rawget(_G, "gng_r2_probe_bootstrapped") then
    print("GNG_R2_PROBE=AUTOboot_REENTRY_IGNORED")
    return
end
_G.gng_r2_probe_bootstrapped = true
local output = assert(os.getenv("GNG_R2_PROBE_DIR"), "GNG_R2_PROBE_DIR missing")
local target = tonumber(os.getenv("GNG_R2_PROBE_FRAMES") or "4")
assert(target and target >= 2 and target <= 30 and target % 1 == 0,
       "R2 probe frames must be 2..30")
local machine = manager.machine
assert(machine.system and machine.system.name == "gngb",
       "R2 gngb driver/ROM mismatch")
local cpu = assert(machine.devices[":maincpu"], "R2 :maincpu unavailable")
local space = assert(cpu.spaces["program"], "R2 maincpu program space unavailable")
local screen = assert(machine.screens[":screen"], "R2 screen unavailable")
local path = output .. "/observations.tsv"
local file = assert(io.open(path, "w"), "Cannot create R2 observations")
file:setvbuf("line")
local finished, file_closed, finishing = false, false, false
local function record(...)
    if file_closed or finished and not finishing then return end
    local values = {...}
    for i, value in ipairs(values) do
        local str = tostring(value):gsub("[\r\n\t]", " ")
        values[i] = str
    end
    assert(file:write(table.concat(values, "\t") .. "\n"))
end
local debugger = machine.debugger
record("PROBE", "r2-mame-capability-v1")
record("DRIVER", machine.system.name)
record("DEBUGGER_AVAILABLE", debugger and "1" or "0")
record("CPU_DEBUGGER_AVAILABLE", (cpu.debug and "1" or "0"))
record("CPU_PROGRAM_WIDTH", tostring(space.data_width))
local bank = machine.memory.banks[":mainbank"]
record("BANK_ENTRY_AVAILABLE", bank and "1" or "0")
if bank then record("BANK_INITIAL_OBSERVED", tostring(bank.entry)) end
local function pc()
    local state = cpu.state["PC"]
    if not state then return "unavailable" end
    return tostring(state.value)
end
local regs = {"PC", "A", "B", "X", "Y", "U", "S", "DP", "CC"}
for _, key in ipairs(regs) do
    record("REGISTER_AVAILABLE", key, cpu.state[key] and "1" or "0")
end
-- Write/read taps are observations, not an instruction-correlated bus log.
-- Taps may be lost when the memory map is replaced; they are not proof
-- of exhaustive RAM/ROM/stack/fetch coverage.
local readCount, writeCount, resetCount, frameCount = 0, 0, 0, 0
-- This reports writes to the bank-select register, NOT completed switches.
-- The memory tap may fire before the MAME gng_state::bankswitch_w handler.
local bankControlWrites = 0
local bankControlSamplesMax = 64
-- Optional R3-only sprite-RAM tap. A memory tap is a board observation,
-- not proof of exhaustive CPU-bus ordering or the post-write memory value.
local sprite_capture = os.getenv("GNG_R2_PROBE_SPRITE_RAM") == "1"
local sprite_write_count = 0
local sprite_sample_limit = 4096
record("SPRITE_RAM_TAP_ENABLED", sprite_capture and "1" or "0")
if sprite_capture then
    gng_r2_sprite_write_tap = assert(space:install_write_tap(
        0x1e00, 0x1fff, "r3-sprite-ram-write-probe",
        function(addr, data, mask)
            sprite_write_count = sprite_write_count + 1
            if sprite_write_count <= sprite_sample_limit then
                -- The CPU state PC in a tap is not necessarily the
                -- pre-instruction PC. Do not use it to match instructions.
                record("SPRITE_RAM_WRITE_BYTE", addr, data & 0xff,
                       mask & 0xff)
            end
            return data
        end), "Failed to install optional R3 sprite RAM write tap")
end
local reset_requested = false
local controlled_reset = os.getenv("GNG_R2_PROBE_SOFT_RESET") == "1"
-- Opt-in R3.6.B2: observe exact CPU program-bus read from the ROM-attested
-- LDA extended operand address. PC inside tap is advisory and NOT an
-- instruction-correlated bus/fetch boundary. Never overwrite native data.
local target_read_raw = os.getenv("GNG_R36_TARGET_READ_ADDRESS")
local target_read_address = nil
local target_read_count = 0
local target_read_limit = 4096
if target_read_raw and target_read_raw ~= "" then
    target_read_address = tonumber(target_read_raw)
    assert(target_read_address and target_read_address % 1 == 0 and
           target_read_address >= 0x3800 and target_read_address <= 0x3fff,
           "R36 exact MMIO target must be decimal 0x3800..0x3fff")
end
record("R36_TARGETED_READ_ENABLED", target_read_address and "1" or "0")
if target_read_address then
    record("R36_TARGETED_READ_ADDR", target_read_address)
end
-- R3.6.B4 (opt-in): read the actual configured unmapped-read policy
-- from the native MAME address map. This is independent of the returned
-- byte observed by the read tap and of the post-LDA A register.
local capture_unmap_policy = os.getenv("GNG_R36_CAPTURE_UNMAP_POLICY") == "1"
record("R36_UNMAP_POLICY_ENABLED", capture_unmap_policy and "1" or "0")
if capture_unmap_policy then
    assert(target_read_address == 0x3c00,
           "R36 map-policy certification is limited to gngb 0x3c00")
    local map = assert(space.map, "R36 native program address map unavailable")
    local value = assert(map.unmap_value,
                         "R36 native unmapped-read policy unavailable")
    assert(type(value) == "number" and value % 1 == 0 and
           value >= 0 and value <= 255 and space.data_width == 8,
           "R36 expected 8-bit native unmapped read policy")
    record("R36_UNMAP_POLICY", value)
    -- This property is the address-map configuration, NOT instruction-specific
    -- evidence of a bus read. The independent tap is recorded separately.
end
local limit = 20
gng_r2_probe_read_tap = space:install_read_tap(
    0x3000, 0x3fff, "r2-mmio-read-probe",
    function(addr, data, mask)
        readCount = readCount + 1
        if target_read_address and addr == target_read_address then
            target_read_count = target_read_count + 1
            if target_read_count <= target_read_limit then
                -- Epoch is separated by the actual observed reset notifier.
                -- The debugger PC is a hint only and is never proof of
                -- which instruction issued this memory access.
                record("R36_TARGETED_READ_BYTE", resetCount,
                       target_read_count, screen:frame_number(),
                       pc(), addr, data & 0xff, mask & 0xff)
            end
        end
        if readCount <= limit then
            record("MMIO_READ_SAMPLE", screen:frame_number(), pc(), addr,
                   data & 0xff)
        end
        return data
    end)
gng_r2_probe_write_tap = space:install_write_tap(
    0x3000, 0x3fff, "r2-mmio-write-probe",
    function(addr, data, mask)
        writeCount = writeCount + 1
        if addr == 0x3e00 then
            bankControlWrites = bankControlWrites + 1
            if bankControlWrites <= bankControlSamplesMax then
                -- bank.entry is sampled INSIDE the write callback and cannot
                -- be interpreted as a post-handler observed bank entry.
                record("BANK_CONTROL_WRITE_SAMPLE", screen:frame_number(),
                       pc(), addr, data & 0xff,
                       bank and tostring(bank.entry) or "unavailable")
            end
        end
        if writeCount <= limit then
            record("MMIO_WRITE_SAMPLE", screen:frame_number(), pc(), addr,
                   data & 0xff)
        end
        return data
    end)
assert(gng_r2_probe_read_tap and gng_r2_probe_write_tap,
       "Cannot retain real MMIO taps")
local function finish(reason)
    if finished then return end
    finished = true
    finishing = true
    record("CONTROLLED_SOFT_RESET_REQUESTED", reset_requested and "1" or "0")
    record("OBSERVED_RESET_COUNT", resetCount)
    record("OBSERVED_FRAME_COUNT", frameCount)
    record("OBSERVED_MMIO_READ_COUNT", readCount)
    record("R36_TARGETED_READ_COUNT", target_read_count)
    record("OBSERVED_MMIO_WRITE_COUNT", writeCount)
    record("OBSERVED_BANK_CONTROL_WRITE_COUNT", bankControlWrites)
    record("OBSERVED_SPRITE_RAM_WRITE_COUNT", sprite_write_count)
    record("PROBE_END", reason)
    assert(file:close())
    file_closed = true
    finishing = false
    print("GNG_R2_PROBE=OBSERVATIONS_RECORDED_NOT_CPU_EQUIVALENCE")
end
gng_r2_reset_subscription = emu.add_machine_reset_notifier(function()
    -- MAME may deliver callbacks around machine shutdown/soft reset after
    -- machine:exit(); never attempt writes on an already closed handle.
    if finished or file_closed then return end
    resetCount = resetCount + 1
    record("RESET_NOTIFICATION", screen:frame_number(), pc())
end)
gng_r2_frame_subscription = emu.add_machine_frame_notifier(function()
    if finished then return end
    frameCount = frameCount + 1
    record("FRAME_SAMPLE", screen:frame_number(), pc(),
           bank and tostring(bank.entry) or "unavailable")
    -- A late-attached Lua script cannot witness the power-on reset. Optionally
    -- schedule a genuine, independently observed SOFT reset after the first
    -- frame. It is NOT evidence of the initial cold reset.
    if controlled_reset and not reset_requested then
        reset_requested = true
        record("SOFT_RESET_REQUESTED", screen:frame_number(), pc())
        machine:soft_reset()
    end
    if frameCount >= target then
        finish("frame-limit")
        machine:exit()
    end
end)
gng_r2_stop_subscription = emu.add_machine_stop_notifier(function()
    finish("machine-stop")
end)
assert(gng_r2_reset_subscription and gng_r2_frame_subscription
       and gng_r2_stop_subscription, "R2 probe notifiers missing")
print("GNG_R2_PROBE=REGISTERED target_frames=" .. target)
