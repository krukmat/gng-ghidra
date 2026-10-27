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

local function capture(kind, address, data)
  if machine:side_effects_disabled() then return end
  seq = seq + 1
  -- Native attotime converted to a common 12-MHz reference clock.
  -- This is independent of the JS main CPU's cycle numbering.
  local tick = machine.time:as_ticks(12000000)
  output:write(string.format(
    '{"kind":"%s","seq":%d,"frame":%d,"tick12m":%d,"address":%d,"value":%d}\n',
    kind, seq, screen.frame_number, tick, address, data & 0xff))
  if seq % 256 == 0 then output:flush() end
end

taps[#taps+1] = main:install_write_tap(0x3a00,0x3a00,"gng-audio-command",
  function(addr,data,mask) capture("SOUNDLATCH_WRITE",addr,data) end)
taps[#taps+1] = main:install_write_tap(0x3d01,0x3d01,"gng-audio-reset",
  function(addr,data,mask) capture("AUDIO_RESET_WRITE",addr,data & 1) end)
taps[#taps+1] = sound:install_read_tap(0xc800,0xc800,"gng-audio-latch-read",
  function(addr,data,mask) capture("Z80_LATCH_READ",addr,data) end)
taps[#taps+1] = sound:install_write_tap(0xe000,0xe003,"gng-audio-ym-registers",
  function(addr,data,mask) capture("YM2203_WRITE",addr,data) end)

-- Prevent taps and output handle from being garbage-collected prematurely.
_G.gng_audio_taps = taps
_G.gng_audio_stop = emu.add_machine_stop_notifier(function()
  output:flush()
  output:close()
end)
print("GNG_AUDIO_MAME_TAPS=ARMED_CAPTURE_ONLY")
