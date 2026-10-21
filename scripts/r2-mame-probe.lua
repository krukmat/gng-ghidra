-- R2.2.A: observe real MAME instruction trace readiness and sampled MMIO.
-- NEVER a complete CPU/oracle trace. Never reconstruct instruction state here.
-- Run ONLY in an independent, private gngb MAME test process.
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
local function record(...)
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
local limit = 20
gng_r2_probe_read_tap = space:install_read_tap(
    0x3000, 0x3fff, "r2-mmio-read-probe",
    function(addr, data, mask)
        readCount = readCount + 1
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
        if writeCount <= limit then
            record("MMIO_WRITE_SAMPLE", screen:frame_number(), pc(), addr,
                   data & 0xff)
        end
        return data
    end)
assert(gng_r2_probe_read_tap and gng_r2_probe_write_tap,
       "Cannot retain real MMIO taps")
local finished = false
local function finish(reason)
    if finished then return end
    finished = true
    record("OBSERVED_RESET_COUNT", resetCount)
    record("OBSERVED_FRAME_COUNT", frameCount)
    record("OBSERVED_MMIO_READ_COUNT", readCount)
    record("OBSERVED_MMIO_WRITE_COUNT", writeCount)
    record("PROBE_END", reason)
    assert(file:close())
    print("GNG_R2_PROBE=OBSERVATIONS_RECORDED_NOT_CPU_EQUIVALENCE")
end
gng_r2_reset_subscription = emu.add_machine_reset_notifier(function()
    resetCount = resetCount + 1
    record("RESET_NOTIFICATION", screen:frame_number(), pc())
end)
gng_r2_frame_subscription = emu.add_machine_frame_notifier(function()
    if finished then return end
    frameCount = frameCount + 1
    record("FRAME_SAMPLE", screen:frame_number(), pc(),
           bank and tostring(bank.entry) or "unavailable")
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
