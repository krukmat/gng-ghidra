-- This file is concatenated AFTER the pinned original Blackbox Lua script.
-- Important: lexical write_timeline() and input_timeline[] belong to that
-- original Lua chunk; this addon never injects controls or modifies its bot.
-- MAME -seconds_to_run exited at ~frame 2334 without running the original
-- stop notifier in the observed operator run. Persist before scheduled exit.
local gng_blackbox_flush_target = 2100
local gng_blackbox_flush_done = false
assert(type(write_timeline) == "function",
       "Pinned Blackbox Lua changed: cannot resolve original write_timeline")
assert(type(input_timeline) == "table",
       "Pinned Blackbox Lua changed: cannot resolve original input_timeline")
-- The notifier subscription is a C++ userdata; keep a global root for the
-- full emulation run. A lexical local in the autoboot chunk can be GC'd.
gng_blackbox_flush_subscription = emu.add_machine_frame_notifier(function()
    if gng_blackbox_flush_done then return end
    local scr = assert(manager.machine.screens[":screen"],
                       "MAME GNG screen not found during pre-exit flush")
    local frame = scr:frame_number()
    if frame < gng_blackbox_flush_target then return end
    -- Require evidence of actual effective input reads, not just plan presence.
    assert(#input_timeline >= 2045,
           "Blackbox effective input timeline stopped recording before gameplay")
    gng_blackbox_flush_done = true
    write_timeline() -- the ORIGINAL Blackbox serializer (file remains private)
    print("GNG_BLACKBOX_DIAG=INPUT_TIMELINE_EARLY_FLUSH frame=" .. frame ..
          " entries=" .. #input_timeline)
    manager.machine:exit() -- graceful schedule; independent of -seconds_to_run
end)
assert(gng_blackbox_flush_subscription,
       "MAME frame notifier missing for Blackbox early timeline flush")
print("GNG_BLACKBOX_DIAG=EARLY_FLUSH_CALLBACK_REGISTERED target=" .. gng_blackbox_flush_target)
