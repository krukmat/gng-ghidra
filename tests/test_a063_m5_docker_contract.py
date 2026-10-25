"""ROM-free static safety checks for M5 local Docker preparation."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class M5DockerContracts(unittest.TestCase):
    def test_shell_syntax(self):
        for name in ("a063-m5-docker.sh", "a063-m5-docker-inner.sh"):
            subprocess.run(["bash", "-n", str(ROOT / "scripts" / name)],
                           check=True, capture_output=True, timeout=10)

    def test_image_has_arm64_only_base_and_no_repo_copy(self):
        text = (ROOT / "docker/a063-m5/Dockerfile").read_text()
        self.assertEqual(text.count("FROM --platform=linux/arm64 "), 2)
        self.assertNotIn("COPY .", text)
        self.assertNotIn("ADD .", text)
        self.assertNotIn("docker buildx bake --push", text)

    def test_host_rejects_remote_and_never_mounts_roms(self):
        text = (ROOT / "scripts/a063-m5-docker.sh").read_text()
        for marker in (
            "remote_docker_host_forbidden",
            "remote_or_unrecognized_docker_endpoint",
            "nonlocal_buildx_driver_forbidden",
            "docker buildx build --builder default --load",
            "dst=/workspace/scripts,readonly",
            "dst=/workspace/patches,readonly",
            "gng-a063-mame0289-arm64-v1",
            "gng-a063-evidence-arm64-v1",
            "git diff --cached --name-only",
        ):
            self.assertIn(marker, text)
        self.assertNotIn("src=$ROOT/roms", text)
        self.assertNotIn("--push", text)
        self.assertNotIn("docker system prune", text)

    def test_guest_requires_exact_upstream_and_patch(self):
        text = (ROOT / "scripts/a063-m5-docker-inner.sh").read_text()
        for marker in (
            "f34f02505e32c1993c6a782b6814232cbfc74e36",
            "mame0289",
            "--verify-applied",
            "--apply",
            "native_linux_arm64_required",
            "PREPARED_NOT_COMPILED",
        ):
            self.assertIn(marker, text)
        self.assertNotIn("roms/gng", text)

if __name__ == "__main__":
    unittest.main()
