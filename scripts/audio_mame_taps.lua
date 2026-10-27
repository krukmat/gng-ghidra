-- B-AUDIO-1 / MAME 0.289 reference capture. Never read or export ROM/RAM.
-- Invoke from a gngb session with -autoboot_script after creating out/audio.
-- Input chronology must be reproduced separately; tap recording alone is NOT parity.
local machine = manager.machine
local main = assert(machine.devices[":maincpu"], "AUDIO_TAP_NO_MAINCPU").spaces["program"]
local sound = assert(machine.devices[":audiocpu"], "AUDIO_TAP_NO_Z80").spaces["program"]
local screen = assert(machine.screens[":screen"], "AUDIO_TAP_NO_SCREEN")
local path = os.getenv("GNG_AUDIO_TAP_OUT") or "out/audio/mame-audio-events.jsonl"
local output = assert(io.open(path, "w"), "AUDIO_TAP_CANNOT_OPEN_OUTPUT")
local seq = 0
local taps = {}
local health_path = os.getenv("GNG_AUDIO_TAP_HEALTH_OUT")
local health = { frames = 0, ym = 0, latch = 0, sound_read = 0,
                 reset = 0, disabled = 0, written = 0,
                 format_errors = 0, write_errors = 0, flush_errors = 0 }
local function save_health(closed)
  if not health_path then return end
  local f = assert(io.open(health_path, "w"), "AUDIO_TAP_HEALTH_FILE_STOP")
  f:write(string.format(
    '{"kind":"GNG_AUDIO_MAME_TAP_HEALTH_V1","tap_armed":true,"frames_observed":%d,"ym_callbacks":%d,"main_latch_callbacks":%d,"sound_latch_callbacks":%d,"reset_callbacks":%d,"disabled_side_effect_callbacks":%d,"written_events":%d,"format_errors":%d,"write_errors":%d,"flush_errors":%d,"capture_closed":%s}\n',
    health.frames, health.ym, health.latch, health.sound_read,
    health.reset, health.disabled, health.written, health.format_errors,
    health.write_errors, health.flush_errors, tostring(closed)))
  f:close()
end

local function capture(kind, address, data)
  if machine:side_effects_disabled() then
    health.disabled = health.disabled + 1
    return
  end
  if kind == "YM2203_WRITE" then health.ym = health.ym + 1 end
  if kind == "SOUNDLATCH_WRITE" then health.latch = health.latch + 1 end
  if kind == "Z80_LATCH_READ" then health.sound_read = health.sound_read + 1 end
  if kind == "AUDIO_RESET_WRITE" then health.reset = health.reset + 1 end

  -- MAME Lua tap exceptions can prevent a row from being written without
  -- stopping the emulated game. Track the failing phase, not private data.
  local good_format, row = pcall(function()
    local tick = machine.time:as_ticks(12000000)
    return string.format(
      '{"kind":"%s","seq":%d,"frame":%d,"tick12m":%d,"address":%d,"value":%d}\\n',
      kind, seq + 1, screen.frame_number, tick, address, data & 0xff)
  end)
  if not good_format or type(row) ~= "string" then
    health.format_errors = health.format_errors + 1
    return
  end
  local good_write, saved = pcall(function() return output:write(row) end)
  if not good_write or not saved then
    health.write_errors = health.write_errors + 1
    return
  end
  seq = seq + 1
  health.written = health.written + 1
  if health.written % 256 == 0 then
    local good_flush, flushed = pcall(function() return output:flush() end)
    if not good_flush or not flushed then
      health.flush_errors = health.flush_errors + 1
    end
  end
end

taps[#taps+1] = main:install_write_tap(0x3a00,0x3a00,"gng-audio-command",
  function(addr,data,mask) capture("SOUNDLATCH_WRITE",addr,data) end)
taps[#taps+1] = main:install_write_tap(0x3d01,0x3d01,"gng-audio-reset",
  function(addr,data,mask) capture("AUDIO_RESET_WRITE",addr,data & 1) end)
taps[#taps+1] = sound:install_read_tap(0xc800,0xc800,"gng-audio-latch-read",
  function(addr,data,mask) capture("Z80_LATCH_READ",addr,data) end)
taps[#taps+1] = sound:install_write_tap(0xe000,0xe003,"gng-audio-ym-registers",
  function(addr,data,mask) capture("YM2203_WRITE",addr,data) end)

-- Save an independent, ROM-free instrumentation heartbeat.
-- This distinguishes an early exit / unarmed script from an actual session
-- with emulated frames advancing and zero observed bus callbacks.
save_health(false)
_G.gng_audio_frame = emu.add_machine_frame_notifier(function()
  health.frames = health.frames + 1
  if health.frames == 1 or health.frames % 60 == 0 then save_health(false) end
end)
-- Prevent taps and subscriptions from being garbage-collected.
_G.gng_audio_taps = taps
_G.gng_audio_stop = emu.add_machine_stop_notifier(function()
  local ok_flush, flush_result = pcall(function() return output:flush() end)
  if not ok_flush or not flush_result then health.flush_errors = health.flush_errors + 1 end
  output:close()
  save_health(true)
end)
print("GNG_AUDIO_MAME_TAPS=ARMED_CAPTURE_ONLY")
