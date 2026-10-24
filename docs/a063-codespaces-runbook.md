# A0.6.3 — Codespaces ROM-free verification

This is a **manual** experiment on branch
`feature/a063-r1-forensics-contract`. It does not use GitHub Actions,
commit to `main`, upload any ROM, or run an emulator with game data.

## From mobile, create your Codespace

1. Open the [feature branch](https://github.com/krukmat/gng-ghidra/tree/feature/a063-r1-forensics-contract).
2. Select **Code → Codespaces → Create codespace on this branch**.
   Choose **4 cores / 16 GB** if available, or start with a lower-cost
   machine if you want to confirm preparation first.
3. Codespaces reads `.devcontainer/devcontainer.json` and installs
   Ubuntu 24.04, MAME build libraries, Python, C++20 and Node 22.
   Docker image setup may take time and uses Codespaces quota.
4. Open the terminal in the Codespace and run:

```bash
bash scripts/a063-codespaces-bootstrap.sh --prepare
```

This performs a C++20 toolchain smoke, checks free disk space and clones
**only public MAME source** at official tag `mame0289` to
`$HOME/a063-mame0289`. The fixed commit must be
`f34f02505e32c1993c6a782b6814232cbfc74e36`.
It checks the patch without applying it.

5. If preparation passes, explicitly initiate the potentially lengthy,
   metered ROM-free regression and compilation:

```bash
bash scripts/a063-codespaces-bootstrap.sh --validate
```

This runs the entire Python/Node regression, the 17-case replay, then
applies the diagnostic patch and builds the `gnga063` MAME 0.289
subset with two parallel compiler jobs. It verifies a fresh ELF binary,
its version, the `gngb` driver, the `gng_a063_bank` symbol and SHA-256.
The runner refuses to claim success unless ALL checks pass.

**IMPORTANT:** `--validate` deliberately requires a **clean, unpatched**
MAME tree. If compilation fails after applying the patch, do not
rerun against the already modified tree or erase evidence; inspect the
failure and create a new clean MAME checkout for another run.

## Report only redacted checkpoints

Success emits:

`R2C=ROM_FREE_READY_NOT_NATIVE_NOT_A063_CERTIFIED evidence=...`

Logs and checksums are kept outside `gng-ghidra`, in
`$HOME/a063-private-romfree-evidence`, with mode 700. Keep full logs
private. To report, paste **only** the exit status, final PASS/BLOCKED
marker, first failing test name or build failure category, and
`checkpoint.txt` status. Never paste tokens, ROMs or raw CPU traces.

A successful ROM-free build is **not** evidence of live bank identity,
and does not certify A0.6.3; a private native mini-probe is still needed.

## Costs and lifecycle

Creating/running a Codespace uses GitHub compute/storage quota; no
charge guarantee is made. **Closing the browser does not stop it**.
Stop it explicitly at [Your Codespaces](https://github.com/codespaces)
using the `…` menu → **Stop codespace**; delete it once you no longer
need its files. A stopped Codespace can still incur storage usage.

If the repository's Codespaces menu is unavailable or the devcontainer
build fails, report the exact error text **without credentials**.

References: https://docs.github.com/en/codespaces/ and
https://docs.mamedev.org/initialsetup/compilingmame.html .
