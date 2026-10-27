-- G5 B4.T2: bounded native Z80 *instruction PC* sampling via MAME debugger.
-- Entire raw MAME disassembly trace stays inside ignored out/audio.
-- Debugger must be enabled with -debug. This does NOT synthesize game sound.
local machine = manager.machine
local dbg = assert(machine.debugger, "AUDIO_Z80_TRACE_DEBUGGER_REQUIRED")
assert(machine.devices[":audiocpu"] and machine.devices[":audiocpu"].debug,
       "AUDIO_Z80_TRACE_SOUND_DEBUGGER_REQUIRED")
local trace_path = assert(os.getenv("GNG_Z80_PC_TRACE_OUT"),
                          "AUDIO_Z80_TRACE_PATH_REQUIRED")
local health_path = assert(os.getenv("GNG_Z80_PC_TRACE_HEALTH_OUT"),
                           "AUDIO_Z80_HEALTH_PATH_REQUIRED")
local frames_limit = tonumber(os.getenv("GNG_Z80_PC_TRACE_FRAME_LIMIT") or "600")
-- Exact relative paths only: the launcher owns freshness/collision checking.
assert(trace_path:match("^out/audio/z80%-native%-pc%-[A-Za-z0-9_-]+%.tr$"),
       "AUDIO_Z80_TRACE_UNSAFE_PATH")
assert(health_path:match("^out/audio/z80%-native%-pc%-[A-Za-z0-9_-]+%-health%.json$"),
       "AUDIO_Z80_HEALTH_UNSAFE_PATH")
assert(frames_limit and frames_limit % 1 == 0 and frames_limit >= 60 and frames_limit <= 1800,
       "AUDIO_Z80_TRACE_BAD_FRAME_LIMIT")
local running = true
local frames = 0
local closed = false
local function health(is_stopped)
  -- Heartbeat reports only instrumentation status, never PCs or instructions.
  local f = assert(io.open(health_path, "w"), "AUDIO_Z80_HEALTH_OPEN_STOP")
  f:write(string.format(
    '{"kind":"GNG_AUDIO_Z80_PC_TRACE_HEALTH_V1","debugger_enabled":true,"trace_armed":true,"frames_observed":%d,"frame_limit":%d,"trace_stopped":%s,"session_closed":%s,"rom_bytes_exported":false}\n',
    frames, frames_limit, tostring(is_stopped), tostring(closed)))
  f:close()
end
local function stop_trace()
  if not running then return end
  running = false
  dbg:command("trace off,audiocpu")
  dbg:command("traceflush")
  health(true)
end
-- MAME execution debugger supports a tracelog action with a stable marker.
-- The ordinary trace line includes disassembly; NEVER share the .tr file.
dbg:command('trace ' .. trace_path .. ',audiocpu,,{tracelog "AUDIOPC=%04X",pc}')
health(false)
_G.gng_z80_trace_frame = emu.add_machine_frame_notifier(function()
  frames = frames + 1
  if running and frames >= frames_limit then stop_trace() end
  if frames == 1 or (frames % 60 == 0) then health(not running) end
end)
_G.gng_z80_trace_stop = emu.add_machine_stop_notifier(function()
  stop_trace()
  closed = true
  health(true)
end)
-- -debug normally starts halted; permit the user to play without a manual
-- console command after script initialization (may vary by MAME build).
dbg:command("go")
print("GNG_Z80_NATIVE_PC_TRACE=ARMED_PRIVATE_ONLY")
