"""ROM-free tests for safe, read-only T4.2 build-failure classification."""
from __future__ import annotations
import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / "scripts/r35_t4_build_diagnose.py"
SH = ROOT / "scripts/r35-t4-build-diagnose.sh"
SPEC = importlib.util.spec_from_file_location("r35diag", PY)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class T4BuildDiagnosisTests(unittest.TestCase):
    def classify(self, log=None, prepare=True, lock=True):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp) / "private-runner"
            base.mkdir()
            if prepare:
                (base / "t4-prepare.ok").write_text("synthetic")
            if lock:
                (base / "t4-build.lock").mkdir()
            if log is not None:
                (base / "t4-build.log").write_text(log)
            return M.classify(Path(temp))

    def test_missing_log_and_existing_lock(self):
        r = self.classify()
        self.assertEqual(r["R35_T4_DIAG_CAUSE"],
                         "PREBUILD_CONTRACT_OR_CONTAINER_FAILURE")
        self.assertEqual(r["R35_T4_DIAG_BUILD_LOCK_PRESENT"], "YES")
        self.assertEqual(r["R35_T4_DIAG_LOG_PRESENT"], "NO")

    def test_known_fail_closed_marker(self):
        r = self.classify("R35_T4_INNER=BLOCKED_MODIFIED_BUILD_SOURCE\n")
        self.assertEqual(r["R35_T4_DIAG_CAUSE"],
                         "INNER_MODIFIED_BUILD_SOURCE")

    def test_compiler_error_redacted(self):
        r = self.classify("PRIVATE_PATH:999: error: private-symbol-not-found\n"
                          "make: *** [target] Error 2\n")
        self.assertEqual(r["R35_T4_DIAG_CAUSE"],
                         "COMPILER_OR_GENERATOR_ERROR")
        self.assertNotIn("private", " ".join(r.values()).lower())

    def test_disk_memory_and_link(self):
        for msg, expected in [
            ("No space left on device", "DISK_EXHAUSTED"),
            ("c++: fatal error: Killed signal terminated program cc1plus",
             "RESOURCE_EXHAUSTION_SUSPECTED"),
            ("undefined reference to private", "LINK_FAILURE"),
            ("make: *** [target] Error 2", "MAKE_FAILURE_UNCLASSIFIED"),
        ]:
            with self.subTest(expected=expected):
                self.assertEqual(self.classify(msg)["R35_T4_DIAG_CAUSE"],
                                 expected)


    def test_compiler_component_and_known_public_api_only(self):
        cases = [
            (
                "src/devices/cpu/m6809/m6809.cpp:471: error: "
                "'total_cycles' was not declared in this scope\n",
                ("M6809_CPP", "UNDECLARED_IDENTIFIER", "TOTAL_CYCLES"),
            ),
            (
                "build/generated/emu/cpu/m6809/m6809.hxx:114: error: "
                "'std::string_view' has no member named 'private_symbol'\n",
                ("M6809_GENERATED", "MISSING_MEMBER", "STRING_VIEW"),
            ),
            (
                "/private/unknown.cpp:2: error: "
                "'sensitive_name' was not declared in this scope\n",
                ("UNKNOWN", "UNDECLARED_IDENTIFIER", "UNKNOWN"),
            ),
            (
                "src/devices/cpu/m6809/base6x09.lst:42: error: expected ';'\n",
                ("M6809_MICROCODE", "SYNTAX", "UNKNOWN"),
            ),
        ]
        for log, expected in cases:
            with self.subTest(expected=expected):
                got = M.compiler_details(log)
                self.assertEqual(
                    (got["R35_T4_DIAG_COMPONENT"],
                     got["R35_T4_DIAG_ERROR_KIND"],
                     got["R35_T4_DIAG_PUBLIC_API"]),
                    expected
                )
                self.assertNotIn("sensitive_name", " ".join(got.values()))
                self.assertNotIn("private", " ".join(got.values()))

    def test_attempt1_warning_as_error_shape(self):
        # Synthetic shape of the ROM-free reproduction of T4.2 attempt 1.
        log = (
            "Compiling src/devices/cpu/m6809/m6809.cpp...\n"
            "../../../../../src/devices/cpu/m6809/m6809.cpp: In member "
            "function 'virtual void m6809_base_device::device_reset()':\n"
            "../../../../../src/devices/cpu/m6809/m6809.cpp:261:5: error: "
            "this 'if' clause does not guard... "
            "[-Werror=misleading-indentation]\n"
            "make: *** [optional.make:731] Error 1\n")
        got = self.classify(log)
        self.assertEqual(got["R35_T4_DIAG_CAUSE"], "COMPILER_OR_GENERATOR_ERROR")
        self.assertEqual(got["R35_T4_DIAG_COMPONENT"], "M6809_CPP")
        self.assertEqual(got["R35_T4_DIAG_ERROR_KIND"], "WARNING_AS_ERROR")
        self.assertEqual(got["R35_T4_DIAG_WERROR_FLAG"],
                         "MISLEADING_INDENTATION")

    def test_level_options_print_with_trailing_equals(self):
        for flag, expected in [("implicit-fallthrough=", "IMPLICIT_FALLTHROUGH"),
                               ("format=", "FORMAT")]:
            with self.subTest(flag=flag):
                got = M.compiler_details(
                    "src/devices/cpu/m6809/m6809.cpp:470:9: error: "
                    f"this statement may fall through [-Werror={flag}]\n")
                self.assertEqual(got["R35_T4_DIAG_WERROR_FLAG"], expected)

    def test_failing_line_beats_parallel_make_context(self):
        got = M.compiler_details(
            "Compiling src/devices/cpu/m6809/m6809.cpp...\n"
            "Compiling src/devices/cpu/m6809/hd6309.cpp...\n"
            "../../../../generated/emu/cpu/m6809/hd6309.hxx:1840:5: error: "
            "private words [-Werror=private-flag]\n")
        self.assertEqual(got["R35_T4_DIAG_COMPONENT"], "HD6309_GENERATED")
        self.assertEqual(got["R35_T4_DIAG_WERROR_FLAG"], "OTHER")
        self.assertNotIn("private", " ".join(got.values()).lower())

    def test_build_failure_still_fixed_category_with_details(self):
        result = self.classify(
            "src/devices/cpu/m6809/m6809.cpp:47: error: "
            "'logerror' was not declared in this scope\n"
            "make: *** [build] Error 1\n")
        self.assertEqual(result["R35_T4_DIAG_CAUSE"],
                         "COMPILER_OR_GENERATOR_ERROR")
        self.assertEqual(result["R35_T4_DIAG_COMPONENT"], "M6809_CPP")
        self.assertEqual(result["R35_T4_DIAG_PUBLIC_API"], "MAME_LOGERROR")


    @unittest.skipUnless(shutil.which("bash"), "bash unavailable")
    def test_wrapper_readonly_no_rebuild(self):
        source = SH.read_text()
        self.assertIn("dst=/evidence,readonly", source)
        self.assertIn("dst=/workspace/scripts,readonly", source)
        self.assertIn("--network none", source)
        self.assertIn("--read-only", source)
        for forbidden in ["make -j", "volume create", "docker build",
                          "r2-mame-probe.sh", "docker exec", "rm -rf"]:
            self.assertNotIn(forbidden, source)
        self.assertEqual(subprocess.run(["bash", "-n", str(SH)],
                                        capture_output=True).returncode, 0)
        for args in (["--build"], ["v3"], ["v1", "v2"]):
            self.assertEqual(subprocess.run(["bash", str(SH), *args],
                                            capture_output=True).returncode, 2)
        self.assertIn("ATTEMPT=\"${1:-v2}\"", source)
        self.assertIn('echo "R35_T4_DIAG_ATTEMPT=$ATTEMPT"', source)


if __name__ == "__main__":
    unittest.main()
