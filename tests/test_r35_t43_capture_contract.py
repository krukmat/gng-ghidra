"""ROM-free contract checks for the single T4.3 cold-boot capture launcher."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "scripts/r35-t43-capture.sh"
INNER = ROOT / "scripts/r35-t43-capture-inner.sh"
LUA = ROOT / "scripts/r35-t43-frames.lua"


class T43CaptureContract(unittest.TestCase):
    def test_host_isolation_authorization_and_new_volume_only(self):
        host = HOST.read_text()
        for token in [
            "--network none", "--read-only", "--cap-drop ALL", "--pull never",
            "--platform linux/arm64", "gng-r35-t43-capture-arm64-v1",
            "src=$WORK,dst=/mame,readonly",
            "src=$EVIDENCE,dst=/t4evidence,readonly",
            "src=$ROOT/roms,dst=/workspace/roms,readonly",
            "src=$ROOT,dst=/workspace,readonly",
            "gng-r35-t4-mame-arm64-v2", "gng-r35-t4-evidence-arm64-v2",
            "CAPTURE_VOLUME_EXISTS_PRESERVE_EVIDENCE",
            "CONCURRENT_VOLUME_CREATION",
            "COMMIT_TRACKED_CHANGES_BEFORE_CAPTURE",
            "grep -E '^R35_T43_[A-Z0-9_]+=[A-Za-z0-9_]+$'",
        ]:
            self.assertIn(token, host)
        # Authorization is checked after --check has exited and before the
        # only volume create.
        approval = host.index(
            '"${GNG_R35_NATIVE_T4_APPROVED:-}" == EXPLICIT_OPERATOR_B2_T4')
        self.assertLess(host.index('if [[ "$MODE" == --check ]]'), approval)
        self.assertLess(approval, host.index("volume create"))
        self.assertEqual(host.count("volume create"), 1)
        # Attempt-1 volumes and the original MAME binary are never mounted.
        for forbidden in ["arm64-v1,dst", "gng-a063-mame0289-arm64-v1",
                          "gng-r35-t4-mame-arm64-v1",
                          "gng-r35-t4-evidence-arm64-v1", "volume rm",
                          "rm -rf", "docker build", "system prune",
                          "src=$ROOT/out"]:
            self.assertNotIn(forbidden, host)

    def test_inner_cold_boot_attested_binary_no_debugger(self):
        inner = INNER.read_text()
        for token in [
            "-oslog", "-noreadconfig", "-autoboot_script",
            "/workspace/scripts/r35-t43-frames.lua",
            "t4-instrumented-bin.sha256", "BINARY_NOT_T42_V2",
            "BINARY_CHANGED_DURING_CAPTURE", "CAPTURE_VOLUME_NOT_EMPTY",
            "for event in CPU_RESET LINE_DELIVERED SYNC_ENTER SYNC_EXIT "
            "IRQ_ENTRY VECTOR_FETCH; do",
            "node scripts/r35_t43_summary.mjs",
        ]:
            self.assertIn(token, inner)
        # Cold boot only: no debugger, soft reset, state, input or playback.
        for forbidden in ["-debug", "SOFT_RESET", "soft_reset", "-state",
                          "-playback", "-autosave", "r2-mame-probe",
                          "rm -rf", "GNG_R35_NATIVE_T4_APPROVED"]:
            self.assertNotIn(forbidden, inner)

    def test_lua_is_passive(self):
        lua = LUA.read_text()
        code = "\n".join(line.split("--", 1)[0] for line in lua.splitlines())
        for forbidden in ["write_u8", "write_direct", "write_range",
                          "set_value", "soft_reset", "hard_reset",
                          "load(", "loadfile", ".value =", "debug"]:
            self.assertNotIn(forbidden, code)
        # Every write tap returns the observed data unchanged.
        taps = re.findall(r"install_write_tap\(", code)
        self.assertEqual(len(taps), 4)
        self.assertEqual(code.count("return data"), 4)
        self.assertIn("screen:frame_number()", code)
        self.assertNotIn("screen.frame_number", code)
        for tag in [":spriteram", ":fgvideoram", ":bgvideoram",
                    ":palette_ext", ":palette"]:
            self.assertIn(f'"{tag}"', code)

    @unittest.skipUnless(shutil.which("bash"), "bash unavailable")
    def test_syntax_and_fail_closed_arguments(self):
        for script in [HOST, INNER]:
            proc = subprocess.run(["bash", "-n", str(script)],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
        for args in (["--bogus"], ["--frames", "1"], ["--frames", "3601"],
                     ["--frames", "06"], ["--check", "--run"], ["--frames"],
                     ["--volume", "gng-r35-t4-evidence-arm64-v2"],
                     ["--volume", "gng-r35-t43-capture-arm64-v0"],
                     ["--volume"]):
            with self.subTest(args=args):
                proc = subprocess.run(["bash", str(HOST), *args],
                                      capture_output=True, text=True)
                self.assertEqual(proc.returncode, 2)
                self.assertRegex(proc.stderr, r"^R35_T43_CAPTURE=BLOCKED_[A-Z0-9_]+\n$")
        proc = subprocess.run(["bash", str(INNER), "--run"],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)

    @unittest.skipUnless(shutil.which("luac") or shutil.which("luac5.4"),
                         "luac unavailable")
    def test_lua_compiles(self):
        luac = shutil.which("luac") or shutil.which("luac5.4")
        proc = subprocess.run([luac, "-p", str(LUA)], capture_output=True,
                              text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)

    @unittest.skipUnless(shutil.which("lua"), "lua unavailable")
    def test_lua_records_frames_against_mocked_mame_api(self):
        # Mocks only the MAME 0.289 APIs the script uses; three notifier
        # calls from frame 0 must yield two records then machine:exit().
        mock = r"""
local taps, notifier, exited = {}, nil, false
local function share(size)
  return {size=size, read_u8=function(self, i) return i & 0xff end}
end
local function stamp() return {seconds=0, attoseconds=16768000000000000} end
-- frame_number is a bound method in luaengine.cpp, not a property.
local current = 0
local screen = {frame_number=function(self) return current end,
  snapshot=function(self, path)
  local f = assert(io.open(path, "wb")); f:write("png"); f:close() end}
manager = {machine={
  system={name="gngb"}, screens={[":screen"]=screen},
  palettes={[":palette"]={entries=256, pen_color=function(self, i) return i end}},
  memory={shares={[":spriteram"]=share(0x200), [":fgvideoram"]=share(0x800),
    [":bgvideoram"]=share(0x800), [":palette_ext"]=share(0x100),
    [":palette"]=share(0x100)}},
  devices={[":maincpu"]={spaces={program={
    install_write_tap=function(self, a, b, name, cb)
      taps[name] = cb; return {} end,
    read_range=function(self, a, b, w) return string.rep("\0", b - a + 1) end}}}},
  exit=function(self) exited = true end}}
manager.machine.time = stamp()
emu = {add_machine_frame_notifier=function(cb) notifier = cb; return {} end}
dofile(arg[1])
assert(taps["gng-t43-dma"](0x3c00, 1, 0xff) == 1)
assert(taps["gng-t43-bank"](0x3e00, 3, 0xff) == 3)
for frame = 0, 2 do current = frame; notifier() end
assert(exited, "no exit")
"""
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            os.mkdir(Path(temp) / "png")
            harness = Path(temp) / "mock.lua"
            harness.write_text(mock)
            env = {**os.environ, "GNG_T43_DIR": temp, "GNG_T43_FRAMES": "2"}
            proc = subprocess.run(["lua", str(harness), str(LUA)], env=env,
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("R35_T43_LUA=FRAMES_RECORDED", proc.stdout)
            record = 0x1e00 + 0x200 + 0x200 + 0x800 + 0x800 + 0x100 + 0x100 + 0x400
            self.assertEqual((Path(temp) / "frames.bin").stat().st_size, 2 * record)
            rows = [json.loads(line) for line in
                    (Path(temp) / "frames.jsonl").read_text().splitlines()]
            self.assertEqual([(r["index"], r["frame"]) for r in rows], [(1, 0), (2, 1)])
            self.assertEqual((rows[0]["dma_writes"], rows[0]["bank"]), (1, 3))
            self.assertEqual((rows[1]["dma_writes"], rows[1]["bank"]), (0, 3))
            self.assertTrue(rows[0]["sprite_buffer_valid"])
            self.assertEqual(sorted(os.listdir(Path(temp) / "png")),
                             ["0000.png", "0001.png"])


if __name__ == "__main__":
    unittest.main()
