"""Safe synthetic fixtures for the Codespaces diagnostic ZIP exporter."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "a063_export_review", ROOT / "scripts" / "a063-export-review.py"
)
assert spec and spec.loader
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class RedactedReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.evidence = self.root / "a063-private-romfree-evidence"
        self.run = self.evidence / "r2c-test-run"
        self.run.mkdir(parents=True)
        self.output = self.root / "out" / "review.zip"
        (self.run / "checkpoint.txt").write_text(
            "status=BLOCKED_UNTIL_ALL_GATES_PASS\n", encoding="utf-8")
        (self.run / "romfree.log").write_text(
            "A063_R2B=BLOCKED test_failure\n"
            "fatal error: synthetic missing header\n"
            "github_pat_FAKESECRET12345\n"
            "roms/gng.zip\n", encoding="utf-8")
        (self.run / "cpu.trace").write_text(
            "SHOULD_NEVER_LEAVE_EVIDENCE\n", encoding="utf-8")
        (self.run / "mame-build.log").write_text(
            "error: sample compiler failure\n", encoding="utf-8")

    def test_redacted_zip_excludes_trace_and_secrets(self):
        path, n = review.export(self.evidence, self.output)
        self.assertEqual((path, n), (self.output, 1))
        with ZipFile(path) as archive:
            self.assertFalse(any("cpu.trace" in x for x in archive.namelist()))
            self.assertTrue(any("romfree.log.redacted" in x for x in archive.namelist()))
            all_text="\n".join(archive.read(name).decode("utf-8")
                                for name in archive.namelist())
            self.assertNotIn("SHOULD_NEVER_LEAVE_EVIDENCE",all_text)
            self.assertNotIn("github_pat_FAKESECRET12345",all_text)
            self.assertNotIn("roms/gng.zip",all_text)
            self.assertIn("<REDACTED>",all_text)
            self.assertIn("<PRIVATE_ROM>",all_text)
            self.assertIn("synthetic missing header",all_text)
            self.assertEqual(json.loads(
                archive.read("review-summary.json"))["runs"][0]["rank"],1)

    def test_missing_runs_fails(self):
        with self.assertRaisesRegex(ValueError,"NO_R2C_RUNS"):
            review.export(self.root/"absent", self.output)

    def test_refuse_zip_inside_evidence(self):
        with self.assertRaisesRegex(ValueError,"OUTSIDE_EVIDENCE"):
            review.export(self.evidence, self.evidence/"untrusted.zip")


if __name__ == "__main__":
    unittest.main()
