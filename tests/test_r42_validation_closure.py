"""Pure mock-process tests for T1/T2/T3 orchestrator. No ROM/MAME needed."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from r42_validation_closure import run_closure, CMD_SCALE, CMD_TESTS, CMD_REGRESSION

TAP = '\n'.join(["TAP version 13", "# tests 9", "# pass 9", "# fail 0",
                 "# cancelled 0", "# skipped 0"])


def manifest():
    return {
        "schema": "gng.r42h.romfree-checkpoint.v1",
        "status": "ROM_FREE_LAB_GATE_PASS_NATIVE_UNVERIFIED",
        "million_event_stress_required": False,
        "mame_executed": False,
        "autonomous_cpu_frame_rendered": False,
        "diagnostic": {"status": "SYNTHETIC_E2E_DIAGNOSTIC_PASS",
                       "native_mame_executed": False, "repeat_identical": True,
                       "changed": {"first_event_seq":0,
                                   "first_byte_divergence":{"region":"SPRITE_DMA","byte_offset":3},
                                   "first_pixel_divergence":{"x":34,"y":66,"channel":"R"}},
                       "post_dma_write":{"first_event_seq":2,"first_pixel_divergence":None,
                                         "equal_components":{"pixels":True}}},
        "scales": [
            {"event_count": n, "window_count": w, "state": "SYNTHETIC_E2E_COMPONENTS_VERIFIED",
             "native_proof": False, "state_sha256": "a"*64}
            for n, w in ((5000,1),(40001,2),(100000,3))
        ]
    }


def fake_runner(cmd, **kwargs):
    if cmd == CMD_TESTS: return subprocess.CompletedProcess(cmd,0,TAP,"")
    if cmd == CMD_SCALE: return subprocess.CompletedProcess(cmd,0,"scale completed","")
    if cmd == CMD_REGRESSION: return subprocess.CompletedProcess(
        cmd,0,"GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H\n","")
    raise AssertionError(cmd)


class ClosureTests(unittest.TestCase):
    def test_complete_evidence_is_rom_free_pass(self):
        report=run_closure(ROOT,runner=fake_runner,manifest_loader=lambda _:manifest(),write=False)
        self.assertEqual(report["status"], "PASS_ROM_FREE_ONLY")
        self.assertEqual(report["tasks"]["T3"]["status"], "ROM_FREE_CLOSED")
        self.assertFalse(report["native_game_frame_verified"])
        self.assertNotIn(TAP,json.dumps(report))

    def test_failed_process_never_claims_pass(self):
        def fail_tests(cmd,**kwargs):
            if cmd==CMD_TESTS:return subprocess.CompletedProcess(cmd,1,TAP,'secret stuff')
            return fake_runner(cmd,**kwargs)
        report=run_closure(ROOT,runner=fail_tests,manifest_loader=lambda _:manifest(),write=False)
        self.assertEqual(report["status"],"FAILED_VALIDATION")
        self.assertEqual(report["tasks"]["T1"]["status"],"NOT_VERIFIED")
        self.assertNotIn('secret stuff',json.dumps(report))

    def test_zero_exit_without_expected_contract_cannot_pass(self):
        bad=manifest();bad["scales"][1]["event_count"]=40000
        report=run_closure(ROOT,runner=fake_runner,manifest_loader=lambda _:bad,write=False)
        self.assertEqual(report["status"],"FAILED_VALIDATION")
        self.assertEqual(report["scales_checked"],[])

    def test_unavailable_binary_is_blocked(self):
        def missing(cmd,**kwargs):
            if cmd==CMD_TESTS:raise FileNotFoundError('node missing')
            return fake_runner(cmd,**kwargs)
        report=run_closure(ROOT,runner=missing,manifest_loader=lambda _:manifest(),write=False)
        self.assertEqual(report["status"],"BLOCKED_ENVIRONMENT")
        self.assertEqual(report["tasks"]["T1"]["tests"]["status"],"BLOCKED_ENVIRONMENT")

    def test_missing_output_manifest_is_not_success(self):
        def missing_manifest(_):raise FileNotFoundError('report missing')
        report=run_closure(ROOT,runner=fake_runner,manifest_loader=missing_manifest,write=False)
        self.assertEqual(report["status"],"FAILED_VALIDATION")

    def test_failure_timeout_is_not_success(self):
        def timeout(cmd,**kwargs):
            if cmd==CMD_REGRESSION:raise subprocess.TimeoutExpired(cmd,timeout=10)
            return fake_runner(cmd,**kwargs)
        report=run_closure(ROOT,runner=timeout,manifest_loader=lambda _:manifest(),write=False)
        self.assertEqual(report["status"],"BLOCKED_ENVIRONMENT")

    def test_real_execution_requires_checkout(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            result=run_closure(Path(d),write=False)
            self.assertEqual(result['status'],'BLOCKED_MISSING_CHECKOUT')
            self.assertEqual(result['tasks']['T3']['status'],'NOT_STARTED')

    def test_report_step_does_not_leak_test_logs(self):
        report=run_closure(ROOT,runner=fake_runner,manifest_loader=lambda _:manifest(),write=False)
        self.assertIn('stdout_sha256',report['tasks']['T1']['tests'])
        self.assertNotIn('_stdout',report['tasks']['T1']['tests'])


if __name__=='__main__':
    unittest.main()
