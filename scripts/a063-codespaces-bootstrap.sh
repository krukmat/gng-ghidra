#!/usr/bin/env bash
# Manual GitHub Codespaces entrypoint for R2.E. No GitHub Actions/ROM access.
# --prepare: audit host and fetch clean public MAME mame0289, no build.
# --validate: clean source required. --resume: exact patched source, incremental ROM-free gate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAME_SOURCE="${A063_MAME_SOURCE:-$HOME/a063-mame0289}"
OFFICIAL_MAME_HEAD="f34f02505e32c1993c6a782b6814232cbfc74e36"
REF="feature/a063-r1-forensics-contract"

fail() { printf 'A063_CODESPACES=BLOCKED reason=%s\n' "$1" >&2; exit 2; }
[[ $# == 1 ]] || fail expected_prepare_or_validate_argument
case "$1" in
  --prepare|--validate|--resume) MODE="$1" ;;
  *) fail unexpected_argument ;;
esac
cd "$ROOT"
[[ -d .git && "$(git branch --show-current)" == "$REF" ]] ||
  fail must_use_original_feature_branch
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  fail tracked_worktree_dirty
[[ ! -e "$ROOT/roms/gng.zip" && ! -e "$ROOT/roms/gngb.zip" ]] ||
  fail no_private_rom_in_codespace

bash scripts/a063-r2d-linux-preflight.sh || fail toolchain_preflight_failed

if [[ "$MODE" == "--prepare" ]]; then
  if [[ ! -d "$MAME_SOURCE/.git" ]]; then
    [[ ! -e "$MAME_SOURCE" ]] || fail mame_destination_exists_not_git
    command -v git >/dev/null || fail git_unavailable
    # Public sources only. Does NOT download game ROMs or run emulation.
    git clone --depth 1 --single-branch --branch mame0289 \
      https://github.com/mamedev/mame.git "$MAME_SOURCE" ||
      fail public_mame_clone_failed
  fi
fi

[[ -d "$MAME_SOURCE/.git" ]] || fail run_prepare_first
[[ "$(git -C "$MAME_SOURCE" rev-parse HEAD)" == "$OFFICIAL_MAME_HEAD" ]] ||
  fail wrong_mame_upstream_commit
[[ "$(git -C "$MAME_SOURCE" describe --tags --exact-match HEAD)" == "mame0289" ]] ||
  fail wrong_mame_tag
if [[ "$MODE" == "--resume" ]]; then
  python3 scripts/a063_patch_mame_oracle.py --mame-source "$MAME_SOURCE" --verify-applied ||
    fail resume_patch_not_exact
else
  [[ -z "$(git -C "$MAME_SOURCE" status --porcelain --untracked-files=no)" ]] ||
    fail mame_source_already_modified
  python3 scripts/a063_patch_mame_oracle.py --mame-source "$MAME_SOURCE" ||
    fail mame_patch_not_applicable
fi

if [[ "$MODE" == "--prepare" ]]; then
  printf 'A063_CODESPACES=PREPARED_NOT_COMPILED\n'
  printf 'A063_NEXT=bash scripts/a063-codespaces-bootstrap.sh --validate\n'
elif [[ "$MODE" == "--resume" ]]; then
  bash scripts/a063-r2c-linux-gate.sh --resume-patched \
    --mame-source "$MAME_SOURCE" --jobs "${A063_MAME_JOBS:-1}"
else
  bash scripts/a063-r2c-linux-gate.sh --mame-source "$MAME_SOURCE" \
    --jobs "${A063_MAME_JOBS:-1}"
fi
