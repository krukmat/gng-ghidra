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

## Send diagnostic results back for review

After running `--validate`, update the feature branch and create a **small
redacted ZIP** from the two most recent local ROM-free attempts:

```bash
git pull --ff-only
python3 scripts/a063-export-review.py
```

The ZIP is written to `out/a063-r2e-review.zip`, an ignored path
inside the Codespace. The export contains only allowlisted ROM-free
checkpoints and shortened, redacted diagnostic logs; it excludes ROM,
native CPU traces, private captures and emulator binaries. Automated
redaction is best effort: **inspect the ZIP before sharing**.

From the browser Codespaces Explorer, expand `out`, right-click the ZIP
(or use the file context menu) and choose **Download**, then attach it
directly to the ChatGPT conversation. Do not commit/upload this ZIP
to GitHub, including a private branch: it is a diagnostic artifact,
not source code.

If you see `A063_REVIEW=NO_R2C_RUNS_FOUND`, then the runner failed
before creating evidence; copy the last 30–50 **non-secret** terminal
lines instead.

## Alternative: share results through the PRIVATE GitHub feature branch

When ChatGPT Android does not provide a convenient file picker, do
**not** commit the ZIP or any raw logs. Stage a **much smaller,
scrubbed, allowlisted** report as Markdown and inspect it before sharing:

```bash
git pull --ff-only
python3 scripts/a063-stage-codespaces-review.py
cat docs/audit/a063-r2e-codespaces-summary.md
```

If the report contains any sensitive information, do not publish it.
After review, intentionally publish **only that one text file**:

```bash
git add docs/audit/a063-r2e-codespaces-summary.md
git commit -m "docs(a063): share redacted Codespaces diagnostic status"
git push origin feature/a063-r1-forensics-contract
```

The assistant can then read the report through the connected GitHub app.
This creates a persistent Git commit on the private feature branch;
it never modifies `main` or triggers workflows directly. If the
repository has automatic push-triggered GitHub Actions, check before
pushing because GitHub itself may start them independently. Do not
push if that would be unacceptable.

The staging tool extracts only status, replay metadata and a small
selection of already-scrubbed error lines. Unlike the ZIP, it **does
not include whole ROM-free logs**. Share the first missing error
category separately if it is omitted by the allowlist.

## One-command review publishing (user authorized)

Once the Codespace has been updated to include this entrypoint:

```bash
git pull --ff-only
bash scripts/a063-publish-codespaces-review.sh
```

The script generates the report again, retaining the **last** 42 diagnostic
lines per ROM-free log, verifies that only a bounded redacted Markdown
summary is staged, then commits and pushes **only**
`docs/audit/a063-r2e-codespaces-summary.md` to
`feature/a063-r1-forensics-contract`. If nothing changed, it reports
`A063_REVIEW_PUBLISH=UNCHANGED_NO_COMMIT`.

It fails closed if the branch or remote differs, tracked files are dirty,
another file is staged, the redaction gate finds recognizable secrets,
or Git cannot push. It never stages full logs or ZIP files, and never
changes `main`.

**Limitations:** redaction is best-effort; this is a private repository
with persistent commit history, not a secure secret vault. The report
contains only a small, curated subset of test/build diagnostics. If it
rejects a suspected secret, do not override the safety gate.

When it prints `A063_REVIEW_PUBLISH=PASS_REDACTED_SUMMARY_ONLY`,
tell the assistant **"subido"**; it can then fetch and diagnose the
latest checkpoint directly from GitHub.

## Recover an interrupted 0.289 compile (R2.E / resume)

The first genuine Codespaces build completed the ROM-free regression and
17/17 synthetic bank replay, applied the approved patch, but stopped
while compiling MAME frontend `luaengine.o`:

```text
g++: fatal error: Terminated signal terminated program cc1plus
```

This means the compiler was terminated externally. The captured log
alone cannot establish whether the trigger was resource pressure,
a stopped Codespace or another signal source. It does **not** show a
patch compilation error.

**Do not reset, clean, delete or clone MAME again.** The source tree
is intentionally modified by the approved read-only diagnostic patch;
existing completed build objects can be reused.

In the existing Codespace, run this one command:

```bash
git pull --ff-only && bash scripts/a063-r2e-validate-and-report.sh
```

The runner inspects the MAME driver state, chooses `--resume` if the
patch is already present, and verifies the entire modified driver
**byte-for-byte against the canonical patch** before building. It
reruns ROM-free tests and replay, then resumes MAME incrementally with
one compiler job by default (`A063_MAME_JOBS=1`). It never
automatically resets MAME source.

It records compiler failure status and, where available, numeric
container cgroup OOM event deltas. It then automatically commits and
pushes **only the sanitized Markdown diagnostic report** to this
private feature branch even when validation fails. A failed build
remains `R2C_BUILD_FAILED`, never `ROM_FREE_READY`.

Expected completion markers:

- `A063_R2E_MODE=--resume`: original patched tree reused
- `A063_R2E=ROMFREE_READY_REPORT_PUBLISHED_NOT_NATIVE`: ROM-free
  build, binary provenance and hash checks passed
- `A063_R2E=BLOCKED validation_failed_report_published`: read the
  new sanitized report on GitHub; do not manually paste a raw log

If the Codespace runs out of RAM even with one compiler job, select a
larger Codespace machine size through its GitHub management controls
before retrying. This consumes additional compute quota. Closing the
browser is not evidence the build is finished. Avoid concurrent
compilations; check for active `make` / `cc1plus` before starting.

No ROM or native pre-instruction trace is uploaded or executed by this
ROM-free recovery. Passing it still does not certify A0.6.3.

## Android reconnection, authentication expiry and idle stops

A mobile/browser **login session expiring** is different from GitHub
stopping the Codespace VM. Reauthentication alone does not prove the
compiler stopped. Closing the browser also does not stop the VM
immediately.

GitHub's default Codespaces idle timeout is **30 minutes**. Interactive
terminal activity, **including terminal output**, resets the idle
timer; a quiet or disconnected workload may reach the limit. When
GitHub stops a Codespace, all running processes (including an in-flight
MAME compiler and the final commit/push) stop. Saved files and already
compiled object files remain when the same Codespace is restarted.
There is also a **12-hour maximum Codespace lifetime**, independent of
activity. A successful push is only guaranteed after the publisher
actually reports success.

Recommended recovery from Android:

1. Reauthenticate and reopen **the existing** Codespace from
   https://github.com/codespaces. Do not create another Codespace.
2. If the previous terminal or build remains active, do not start a
   second build. The script now also uses a private Linux `flock`
   lock to reject concurrent invocations.
3. If nothing is running, use the same one-command recovery:

```bash
git pull --ff-only && bash scripts/a063-r2e-validate-and-report.sh
```

The runner detects the already applied, *exact* diagnostic patch and
resumes the existing MAME build objects using one compiler job. It then
publishes a redacted checkpoint through GitHub. It cannot restart
automatically **while the Codespace VM is stopped**; a person must
start that same Codespace again first.

For **new** Codespaces, increase GitHub **Settings → Codespaces →
Default idle timeout** to a suitable period between **5 and 240
minutes**; GitHub states the setting applies to Codespaces created
after the change. Larger values consume more billable compute when
the VM is idle. Do not assume the changed default extends an
already-created Codespace.

To inspect an existing Codespace's actual policy when GitHub CLI is
available and authenticated:

```bash
gh codespace view -c "$CODESPACE_NAME" --json state,idleTimeoutMinutes
```

If GitHub reports an active session but a vanished terminal, reconnect
before inferring a build failure. A SIGTERM in a build log alone cannot
distinguish an idle/VM stop from other external termination causes.

Official references:
- https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces
- https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle

## Mobile browser logout and Codespaces timeout

GitHub Codespaces has **two independent lifecycles**:

- Android/browser login may expire or disconnect. A running Codespace
  does not automatically stop just because the browser tab closes.
- The Codespace can stop after **30 minutes of inactivity by default**
  (terminal output/activity counts toward activity), or after a
  **maximum 12-hour lifetime** even if actively used. When it stops,
  running processes stop too. No shell wrapper or `nohup` can
  override a stopped VM.

We use a session launcher so a browser logout alone does not send
a terminal hangup signal to our validation process. The launcher
stores a private log and run state **outside the repository**, and
prevents launching a second build at the same time:

```bash
git pull --ff-only && bash scripts/a063-r2e-session.sh start
```

On reconnection/relogin, in the same Codespace terminal:

```bash
bash scripts/a063-r2e-session.sh status
```

- `RUNNING`: no action; do not start another build.
- `PASS`: report has been generated/published if Git credentials worked.
- `FAILED:N`: inspect the sanitized GitHub report; compilation or
  publishing failed.
- `INTERRUPTED_OR_CODESPACE_STOPPED`: re-run `start` below.
- `NOT_STARTED`: no session was started with this launcher.

To resume after actual Codespace shutdown or stopped build:

```bash
bash scripts/a063-r2e-session.sh start
```

`start` safely fetches the feature branch, invokes the existing
incremental MAME resume gate when the exact patch is already applied,
uses one compilation job by default for resumption, and commits/pushes
only the sanitized diagnostic report on completion.

**Browser authentication:** GitHub may require signing in again.
The launcher cannot bypass this or renew a web login. If authentication
prevents pushing after the build, reauthenticate and use
`bash scripts/a063-publish-codespaces-review.sh` to publish the
already collected, redacted report **without recompiling**.

**Cost/idle timeout:** To choose a longer default for **new**
Codespaces, go to GitHub Settings → Codespaces → Default idle timeout.
Allowed values are 5–240 minutes; longer settings increase potential
compute charges. Changing the default does **not** retroactively
guarantee a longer timeout on the existing Codespace. No artificial
keepalive process is installed or recommended.

Reference:
https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle

## Current Codespace: bounded interactive compile progress (2026-10-24)

For the existing Codespace, do **not** rebuild the devcontainer or switch
to a new Codespace just to change the idle timeout: this risks losing
work already compiled in the external MAME checkout in the container.
GitHub only exposes per-Codespace `--idle-timeout` when creating a
Codespace; `gh codespace edit` cannot change it for an existing one.

Use **one foreground command** if you can keep the Codespaces terminal
connected while the compiler runs:

```bash
git pull --ff-only && bash scripts/a063-r2e-validate-and-report.sh
```

The ROM-free runner now:
- Defaults to **one** compiler job for both fresh and resumed MAME builds
  (not two), avoiding the highest `cc1plus` memory spikes.
- Reuses previously compiled object files and verifies the exact
  approved diagnostic driver patch before any incremental build.
- Emits `R2C_BUILD_ACTIVE` to the **interactive terminal every 180
  seconds**, only while actually compiling. GitHub documents that
  terminal output resets its idle timer **while that terminal is
  connected and receiving output**. If the browser disconnects and
  output no longer reaches a terminal, this may not help; GitHub may
  stop the Codespace as usual.
- Stops a single build attempt after **180 minutes**, reports elapsed
  seconds and exit status, and stops its periodic reporter on exit.
  The cap can be set using `A063_BUILD_LIMIT_MINUTES` from 30 to 360;
  the progress interval can be changed with
  `A063_BUILD_HEARTBEAT_SECONDS` from 120 to 600.
- Publishes **only the redacted Markdown review**, including failure
  checkpoints, to the private feature branch after completion.

A **background/nohup** launch with `a063-r2e-session.sh start`
survives an ordinary browser disconnect while the Codespace VM
remains on, but it writes to a private logfile, **not** an active
terminal. It therefore **cannot** be relied on to reset the idle
timer, and it cannot bypass a VM stop, authentication expiry, the
12-hour maximum lifetime or billing rules.

Do not switch to a larger Codespace machine solely on the basis of
`cc1plus ... Terminated`: the first report did not prove an OOM kill.
The next failure report will record numeric cgroup OOM deltas to
inform that choice. Changing existing Codespace machine type requires
a restart and can increase compute costs.

References:
- https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces
- https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle
- https://cli.github.com/manual/gh_codespace_edit
