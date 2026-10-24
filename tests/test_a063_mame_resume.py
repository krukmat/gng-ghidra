"""ROM-free checks that interrupted MAME rebuilds only reuse the exact approved patch."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch as mock_patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import a063_patch_mame_oracle as oracle

PATCH = ROOT / "patches" / "mame0289-a063-bank-oracle.patch"


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.PIPE,
                   stderr=subprocess.PIPE, timeout=20)


class ResumeSourceIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.mame = Path(self.temp.name)
        file = self.mame / oracle.TARGET
        file.parent.mkdir(parents=True)
        lines = ["// synthetic fixture\n"] * 700
        lines[34:39] = ['#include "emu.h"\n', "\n",
                        '#include "cpu/m6809/m6809.h"\n',
                        '#include "cpu/z80/z80.h"\n',
                        '#include "machine/74259.h"\n']
        lines[540:546] = [
            "\tm_mainbank->configure_entries(0, 4, &rombase[0x10000], 0x2000);\n",
            "\tm_mainbank->configure_entry(4, &rombase[0x4000]);\n",
            "\n", "\tsave_item(NAME(m_scrollx));\n",
            "\tsave_item(NAME(m_scrolly));\n", "}\n",
        ]
        file.write_text("".join(lines), encoding="utf-8")
        run("git", "-C", str(self.mame), "init", "-q")
        run("git", "-C", str(self.mame), "add", "--", oracle.TARGET)
        run("git", "-C", str(self.mame), "-c", "user.name=synthetic-test",
            "-c", "user.email=test.invalid@example.org",
            "commit", "-qm", "synthetic test baseline")
        run("git", "-C", str(self.mame), "apply", str(PATCH))
        self.target = file

    def check(self):
        original_git = oracle.git

        def pretend_tag_and_commit(mame, *args):
            if args == ("describe", "--tags", "--exact-match", "HEAD"):
                return "mame0289"
            if args == ("rev-parse", "HEAD"):
                return "f34f02505e32c1993c6a782b6814232cbfc74e36"
            return original_git(mame, *args)

        # Synthetic fixture intentionally has a fake tag and SHA only in
        # this test; production CLI always checks the real upstream ref.
        with mock_patch.object(oracle, "git", side_effect=pretend_tag_and_commit):
            oracle.validate_applied(self.mame)

    def test_exact_patch_is_accepted(self):
        self.check()

    def test_modified_patch_is_rejected(self):
        self.target.write_text(self.target.read_text() +
                               "// unrelated accidental edit\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "NOT_EXACT_EXPECTED"):
            self.check()

    def test_untouched_tree_is_rejected(self):
        run("git", "-C", str(self.mame), "checkout", "--", oracle.TARGET)
        with self.assertRaisesRegex(ValueError, "UNEXPECTED_TRACKED"):
            self.check()

    def test_other_tracked_changes_are_rejected(self):
        other = self.mame / "unrelated.cpp"
        other.write_text("a\n", encoding="utf-8")
        run("git", "-C", str(self.mame), "add", "--", "unrelated.cpp")
        run("git", "-C", str(self.mame), "-c", "user.name=synthetic-test",
            "-c", "user.email=test.invalid@example.org",
            "commit", "-qm", "extra baseline")
        other.write_text("b\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "UNEXPECTED_TRACKED"):
            self.check()


if __name__ == "__main__":
    unittest.main()
