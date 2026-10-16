"""ROM-free visual roadmap review; screenshots never auto-certify a milestone."""
from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location("visual_progress",ROOT/"scripts/visual-progress.py")
progress=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(progress)
MANIFEST=ROOT/"docs/visual-milestones.json"


class VisualProgressTests(unittest.TestCase):
    def test_dashboard_generated_without_ever_claiming_playability(self):
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/"out"/"visual-progress.html"
            result=progress.build(MANIFEST,Path(temp)/"visual-evidence",out)
            self.assertEqual(result["milestones"],7)
            self.assertEqual(result["accepted"],0)
            self.assertEqual(result["local_screenshots"],0)
            page=out.read_text()
            self.assertIn("V0",page)
            self.assertIn("V1.3",page)
            self.assertIn("TRANSLATED GAME FRAME",page)
            self.assertIn("Sin captura local",page)
            self.assertIn("ningún estado",page.lower())

    def test_screenshot_is_local_evidence_not_an_acceptance(self):
        from base64 import b64decode
        # Single transparent PNG, used only as an attachment fixture.
        png=b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==")
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)
            img=base/"visual-evidence"/"v0"/"after.png"
            img.parent.mkdir(parents=True)
            img.write_bytes(png)
            out=base/"visual-progress.html"
            result=progress.build(MANIFEST,base/"visual-evidence",out)
            self.assertEqual(result["local_screenshots"],1)
            self.assertEqual(result["accepted"],0)
            page=out.read_text()
            self.assertIn("data:image/png;base64,",page)
            self.assertIn("pendiente verificar en Mac",page)

    def test_unknown_status_or_duplicate_id_fails_closed(self):
        source=json.loads(MANIFEST.read_text())
        source["milestones"][0]["status"]="PASS_BY_SCREENSHOT"
        with self.assertRaisesRegex(ValueError,"Unsupported milestone status"):
            progress.render(source,Path("unused"))
        source=json.loads(MANIFEST.read_text())
        source["milestones"][1]["id"]="V0"
        with self.assertRaisesRegex(ValueError,"Duplicate milestone"):
            progress.render(source,Path("unused"))

    def test_unsafe_identifiers_and_missing_dependencies_fail_closed(self):
        source=json.loads(MANIFEST.read_text())
        source["milestones"][0]["id"]="../sensitive"
        with self.assertRaisesRegex(ValueError,"Unsafe milestone identifier"):
            progress.render(source,Path("unused"))
        source=json.loads(MANIFEST.read_text())
        source["milestones"][1]["dependencies"]=["MISSING"]
        with self.assertRaisesRegex(ValueError,"Unresolved milestone dependencies"):
            progress.render(source,Path("unused"))

    def test_screenshot_too_large_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)
            img=base/"v0"/"after.png"
            img.parent.mkdir(parents=True)
            img.write_bytes(b"X"*(progress.MAX_IMAGE_BYTES+1))
            with self.assertRaisesRegex(ValueError,"too large"):
                progress.render(json.loads(MANIFEST.read_text()),base)


if __name__=="__main__":
    unittest.main()
