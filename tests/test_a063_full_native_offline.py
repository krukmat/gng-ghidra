"""ROM-free offline workflow tests; mocked tools never read native evidence."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class FullNativeOfflineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.repo = self.base / "repo with spaces"
        (self.repo / "scripts").mkdir(parents=True)
        shutil.copy(ROOT / "scripts/r3-banked-critical-path.sh", self.repo / "scripts")
        self.offline = self.repo / "out/r3/full-native-offline"
        self.originals = {
            "out/r2/mame-probe/cpu.trace": "synthetic unchanged capture\n",
            "out/r3/banked-rom/report.json": '{"synthetic":"original inventory"}\n',
            "out/r3/unmapped-read-policy/report.json": '{"synthetic":"capture B4"}\n',
            "out/r3/native-video-writes/report.json": '{"synthetic":"capture video"}\n',
            "out/r3/banked-provenance/private-a063-preflight.json": '{"synthetic":true}\n',
        }
        for relative, content in self.originals.items():
            path = self.repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.calls = self.base / "calls.jsonl"
        self.env = dict(os.environ,
                        PATH=f'{self.bin}:{os.environ["PATH"]}',
                        TEST_REPO=str(self.repo), TEST_CALLS=str(self.calls))
        mock = f"#!{sys.executable}\n" + '''import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
root = Path(os.environ['TEST_REPO'])
offline = root / 'out/r3/full-native-offline'
if name == 'mame':
    stage = 'native_execution_forbidden'
elif args[:1] == ['scripts/a063_capture_integrity.py']:
    stage = 'verify'
elif args[:1] == ['scripts/r3_bank_inventory.py']:
    stage = 'inventory'
elif args[:1] == ['scripts/r3_bank_provenance.py']:
    stage = args[1]
elif args[:1] == ['scripts/r3_unmapped_read_policy.mjs']:
    stage = 'B4'
elif args[:1] == ['scripts/r3_native_video_write_gate.mjs']:
    stage = 'video'
elif args[:1] == ['scripts/r3_banked_static_gate.mjs']:
    stage = 'static'
else:
    stage = 'unexpected_command'
with open(os.environ['TEST_CALLS'], 'a') as stream:
    stream.write(json.dumps({'stage': stage, 'tool': name, 'args': args,
                             'offline_exists': offline.exists()}) + '\\n')
if stage == 'verify':
    sys.exit(int(os.environ.get('TEST_INTEGRITY_EXIT', '0')))
if stage in ('inventory', 'B4', 'video'):
    # Simulate the real gates' output behavior, including partial B4 failure.
    defaults = {'inventory': 'banked-rom', 'B4': 'unmapped-read-policy',
                'video': 'native-video-writes'}
    target = (Path(args[args.index('--out') + 1]) if '--out' in args
              else root / 'out/r3' / defaults[stage])
    target.mkdir(parents=True, exist_ok=True)
    (target / 'report.json').write_text(json.dumps({'synthetic_stage': stage}))
    if stage == 'B4':
        sys.exit(int(os.environ.get('TEST_B4_EXIT', '0')))
elif stage == 'report':
    (root / 'out/r3/banked-provenance/report.json').write_text('{"synthetic":true}')
elif stage not in ('diagnose', 'static'):
    sys.exit(99)
'''
        for name in ("python3", "node", "mame"):
            path = self.bin / name
            path.write_text(mock)
            path.chmod(0o755)
        self.env["GNG_R3_MAME_BIN"] = str(self.bin / "mame")

    def run_offline(self, *args, **env):
        return subprocess.run(
            ["bash", str(self.repo / "scripts/r3-banked-critical-path.sh"), *args],
            env=dict(self.env, **env), text=True, capture_output=True, timeout=10,
        )

    def recorded_calls(self):
        if not self.calls.exists():
            return []
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def assert_originals_unchanged(self):
        for relative, content in self.originals.items():
            self.assertEqual((self.repo / relative).read_text(), content, relative)

    def test_verified_workflow_uses_new_outputs_in_order_without_native_execution(self):
        result = self.run_offline("--full-oracle")
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.recorded_calls()
        self.assertEqual([call["stage"] for call in calls],
                         ["verify", "inventory", "diagnose", "report", "B4", "video", "static"])
        self.assertFalse(calls[0]["offline_exists"])
        self.assertTrue(all(call["offline_exists"] for call in calls[1:]))
        self.assertEqual(calls[0]["args"], [
            "scripts/a063_capture_integrity.py", "--verify", "--output",
            str(self.repo / "out/r2/mame-probe"), "--preflight",
            str(self.repo / "out/r3/banked-provenance/private-a063-preflight.json"),
            "--mame-bin", self.env["GNG_R3_MAME_BIN"],
        ])
        self.assertEqual(calls[1]["args"], [
            "scripts/r3_bank_inventory.py", "--out", str(self.offline / "bank-inventory"),
        ])
        self.assertEqual(calls[3]["args"], [
            "scripts/r3_bank_provenance.py", "report", "--mame-bin", self.env["GNG_R3_MAME_BIN"],
        ])
        self.assertEqual(calls[4]["args"], [
            "scripts/r3_unmapped_read_policy.mjs", "--out",
            str(self.offline / "unmapped-read-policy"),
        ])
        self.assertEqual(calls[5]["args"], [
            "scripts/r3_native_video_write_gate.mjs", "--out",
            str(self.offline / "native-video-writes"),
        ])
        self.assertEqual(calls[6]["args"], ["scripts/r3_banked_static_gate.mjs"])
        self.assert_originals_unchanged()

    def test_failed_integrity_creates_no_offline_or_report_outputs(self):
        result = self.run_offline("--full-oracle", TEST_INTEGRITY_EXIT="23")
        self.assertEqual(result.returncode, 23)
        self.assertEqual([call["stage"] for call in self.recorded_calls()], ["verify"])
        self.assertFalse(self.offline.exists())
        self.assertFalse((self.repo / "out/r3/banked-provenance/report.json").exists())
        self.assert_originals_unchanged()

    def assert_collision_rejected(self):
        result = self.run_offline("--full-oracle")
        self.assertEqual(result.returncode, 2)
        self.assertIn("offline_output_exists_preserve_evidence", result.stderr)
        self.assertEqual(self.recorded_calls(), [])
        self.assertFalse((self.repo / "out/r3/banked-provenance/report.json").exists())
        self.assert_originals_unchanged()

    def test_existing_partial_offline_directory_is_preserved_without_commands(self):
        self.offline.mkdir()
        partial = self.offline / "partial.json"
        partial.write_text('{"synthetic":"keep"}\n')
        self.assert_collision_rejected()
        self.assertEqual(partial.read_text(), '{"synthetic":"keep"}\n')

    def test_existing_offline_file_is_preserved_without_commands(self):
        self.offline.write_text("synthetic partial file\n")
        self.assert_collision_rejected()
        self.assertEqual(self.offline.read_text(), "synthetic partial file\n")

    def test_offline_symlink_to_existing_directory_preserves_its_target(self):
        target = self.base / "external output"
        target.mkdir()
        marker = target / "sentinel"
        marker.write_text("synthetic untouched\n")
        self.offline.symlink_to(target, target_is_directory=True)
        self.assert_collision_rejected()
        self.assertTrue(self.offline.is_symlink())
        self.assertEqual(list(target.iterdir()), [marker])
        self.assertEqual(marker.read_text(), "synthetic untouched\n")

    def test_dangling_offline_symlink_is_preserved_without_creating_target(self):
        target = self.base / "missing target"
        self.offline.symlink_to(target, target_is_directory=True)
        self.assert_collision_rejected()
        self.assertTrue(self.offline.is_symlink())
        self.assertFalse(target.exists())

    def test_failed_b4_preserves_partial_run_and_stops_video_and_static(self):
        result = self.run_offline("--full-oracle", TEST_B4_EXIT="2")
        self.assertEqual(result.returncode, 2)
        calls = self.recorded_calls()
        self.assertEqual([call["stage"] for call in calls],
                         ["verify", "inventory", "diagnose", "report", "B4"])
        partial = self.offline / "unmapped-read-policy/report.json"
        self.assertTrue(partial.is_file())
        self.assertFalse((self.offline / "native-video-writes").exists())
        self.assert_originals_unchanged()
        before = self.calls.read_text()
        retry = self.run_offline("--full-oracle")
        self.assertEqual(retry.returncode, 2)
        self.assertIn("offline_output_exists_preserve_evidence", retry.stderr)
        self.assertEqual(self.calls.read_text(), before)
        self.assertTrue(partial.is_file())


if __name__ == "__main__":
    unittest.main()
