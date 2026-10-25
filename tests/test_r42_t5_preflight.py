from __future__ import annotations
import sys
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from r42_t5_preflight import preflight,REQUIRED
SHA='a'*40

def fake(cmd,cwd):
    return SHA if cmd[:2]==['git','rev-parse'] else 'v22.16.0'

class PreflightTests(unittest.TestCase):
    def make_root(self):
        tmp=tempfile.TemporaryDirectory()
        root=Path(tmp.name);(root/'.git').mkdir()
        for path in REQUIRED:
            dest=root/path;dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_text('# placeholder\n')
        return tmp,root
    def test_missing_checkout_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            data=preflight(Path(d),probe=fake)
            self.assertEqual(data['status'],'BLOCKED_MISSING_CHECKOUT')
            self.assertTrue(data['missing_paths'])
    def test_complete_file_manifest_only_means_ready_to_attempt(self):
        tmp,root=self.make_root()
        try:
            data=preflight(root,probe=fake)
            self.assertEqual(data['status'],'READY_TO_ATTEMPT_REGRESSION')
            self.assertFalse(data['full_suite_executed'])
            self.assertFalse(data['native_equivalence_verified'])
        finally:tmp.cleanup()
    def test_wrong_expected_head_is_blocked(self):
        tmp,root=self.make_root()
        try:self.assertEqual(preflight(root,'b'*40,probe=fake)['status'],'BLOCKED_HEAD_MISMATCH')
        finally:tmp.cleanup()
    def test_missing_node_is_blocked(self):
        tmp,root=self.make_root()
        try:
            def no_node(cmd,cwd):return SHA if cmd[0]=='git' else None
            self.assertEqual(preflight(root,probe=no_node)['status'],'BLOCKED_RUNTIME')
        finally:tmp.cleanup()
    def test_runner_missing_declared_dependencies_rejects(self):
        tmp,root=self.make_root()
        try:
            (root/'scripts/r3-local-regression.sh').write_text('node --check src/nonexistent.mjs\n')
            data=preflight(root,probe=fake)
            self.assertEqual(data['status'],'BLOCKED_MISSING_CHECKOUT')
            self.assertIn('src/nonexistent.mjs',data['missing_paths'])
        finally:tmp.cleanup()
if __name__=='__main__':unittest.main()
