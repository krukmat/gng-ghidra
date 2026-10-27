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
                 format_errors = 0, write_errors = 0, flush_errors = 0,
                 clock_errors = 0, value_errors = 0, clock_fallbacks = 0 }
local function save_health(closed)
  if not health_path then return end
  local f = assert(io.open(health_path, "w"), "AUDIO_TAP_HEALTH_FILE_STOP")
  f:write(string.format(
    '{"kind":"GNG_AUDIO_MAME_TAP_HEALTH_V1","tap_armed":true,"frames_observed":%d,"ym_callbacks":%d,"main_latch_callbacks":%d,"sound_latch_callbacks":%d,"reset_callbacks":%d,"disabled_side_effect_callbacks":%d,"written_events":%d,"format_errors":%d,"write_errors":%d,"flush_errors":%d,"clock_errors":%d,"value_errors":%d,"clock_fallbacks":%d,"capture_closed":%s}\n',
    health.frames, health.ym, health.latch, health.sound_read,
    health.reset, health.disabled, health.written, health.format_errors,
    health.write_errors, health.flush_errors, health.clock_errors,
    health.value_errors, health.clock_fallbacks, tostring(closed)))
  f:close()
end

-- MAME's Lua bindings can return numeric values as floats or 64-bit
-- wrappers. Lua's string.format %d requires a native integer; use
-- bounded exact decimal formatting for our short laboratory captures.
local function decimal(value, upper)
  local n = tonumber(value)
  if n == nil then n = tonumber(tostring(value)) end
  if n == nil or n ~= n or n < 0 or n > upper or n % 1 ~= 0 then
    return nil
  end
  return string.format("%.0f", n)
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

  -- Numeric conversions, clock access, serialization and file I/O are
  -- tracked separately. Do not log any ROM, address, register or sound value.
  local ok_clock, native_tick = pcall(function()
    return machine.time:as_ticks(12000000)
  end)
  if not ok_clock then
    health.clock_errors = health.clock_errors + 1
    return
  end
  local tick = decimal(native_tick, 12000000 * 3600)
  if tick == nil then
    -- Laboratory-only fallback, potentially +/- one 12MHz tick:
    -- keep clock_fallbacks in heartbeat and do NOT claim MAME timing parity.
    local ok_fallback, seconds = pcall(function()
      return machine.time:as_double()
    end)
    if not ok_fallback then
      health.clock_errors = health.clock_errors + 1
      return
    end
    local n = tonumber(seconds)
    if n ~= nil and n >= 0 then tick = decimal(math.floor(n * 12000000), 12000000 * 3600) end
    if tick == nil then
      health.clock_errors = health.clock_errors + 1
      return
    end
    health.clock_fallbacks = health.clock_fallbacks + 1
  end
  local frame = decimal(screen.frame_number, 1000000000)
  local addr = decimal(address, 65535)
  local value_number = tonumber(data)
  if value_number == nil then value_number = tonumber(tostring(data)) end
  local value = value_number and decimal(value_number % 256, 255) or nil
  if not frame or not addr or not value then
    health.value_errors = health.value_errors + 1
    return
  end
  -- %s is intentional: it preserves validated decimal integers regardless
  -- of their Lua number subtype, avoiding %d conversion exceptions.
  local good_format, row = pcall(function()
    return string.format(
      '{"kind":"%s","seq":%s,"frame":%s,"tick12m":%s,"address":%s,"value":%s}\n',
      kind, decimal(seq + 1, 1000000), frame, tick, addr, value)
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
