#!/usr/bin/env python3
"""ROM-free private postflight: bind planned debugger action to produced files.

Never proves the captured files came from a genuine emulator, nor identifies a ROM
bank. All output stays in ignored out/ and contains only hashes/aggregate status.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import a063_trace_contract as contract

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = (
    "start-debugger.txt", "cpu.trace", "pre-instruction.jsonl",
    "observations.tsv", "mame.log", "pretrace-report.json", "capabilities.json",
)
SCHEMA = "gng.a063.private-capture-postflight.v1"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def source_identity(root: Path) -> dict:
    """Local git metadata only; no branch contents or private data."""
    def git(*args: str) -> str:
        p = subprocess.run(["git", "-C", str(root), *args],
                           capture_output=True, text=True, timeout=10, check=True)
        return p.stdout.strip()
    try:
        sha = git("rev-parse", "HEAD")
        dirty = bool(git("status", "--porcelain", "--untracked-files=no"))
    except (OSError, subprocess.SubprocessError) as exc:
        raise contract.ContractError("A063_POSTFLIGHT_GIT_IDENTITY_UNAVAILABLE") from exc
    if len(sha) != 40 or any(c not in "0123456789abcdef" for c in sha):
        raise contract.ContractError("A063_POSTFLIGHT_GIT_IDENTITY_INVALID")
    return {"git_head": sha, "tracked_tree_clean": not dirty}


def capture_postflight(root: Path, output: Path, preflight: Path, first: str,
                       second: str, mame_bin: str, mame_exit: int,
                       *, identity: dict | None = None) -> dict:
    root = root.resolve()
    out = output.resolve()
    private_r2 = (root / "out" / "r2").resolve()
    private_smoke = (root / "out" / "r3" / "a063-smoke").resolve()
    oracle_smoke = (root / "out" / "r3" / "a063-oracle-smoke").resolve()
    oracle_smoke = (root / "out" / "r3" / "a063-oracle-smoke").resolve()
    private_r3 = (root / "out" / "r3").resolve()
    preflight = preflight.resolve()
    if not (out.is_relative_to(private_r2) or out in (private_smoke, oracle_smoke)):
        raise contract.ContractError("A063_POSTFLIGHT_PRIVATE_CAPTURE_LOCATION_REQUIRED")
    if (not preflight.is_relative_to(private_r3) or
            not preflight.name.startswith("private-") or
            not preflight.is_file()):
        raise contract.ContractError("A063_POSTFLIGHT_PRIVATE_PREFLIGHT_REQUIRED")
    if type(mame_exit) is not int or not 0 <= mame_exit <= 255:
        raise contract.ContractError("A063_POSTFLIGHT_EXIT_CODE_INVALID")
    contract.validate_offsets(first, second)
    try:
        planned = json.loads(preflight.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise contract.ContractError("A063_POSTFLIGHT_PREFLIGHT_INVALID") from exc
    oracle = planned.get("oracle_mode", False)
    if type(oracle) is not bool or (oracle and out != oracle_smoke):
        raise contract.ContractError("A063_POSTFLIGHT_ORACLE_MODE_INVALID")
    if out == oracle_smoke and not oracle:
        raise contract.ContractError("A063_POSTFLIGHT_ORACLE_REQUIRED")
    planned_action = contract.build_action(first, second, oracle=oracle)
    expected_action_sha = hashlib.sha256(planned_action.encode()).hexdigest()
    try:
        planned = json.loads(preflight.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise contract.ContractError("A063_POSTFLIGHT_PREFLIGHT_INVALID") from exc
    exe = shutil.which(mame_bin)
    if not exe:
        raise contract.ContractError("A063_POSTFLIGHT_MAME_UNAVAILABLE")
    source_files = planned.get("source_sha256")
    if not isinstance(source_files, dict) or not source_files:
        raise contract.ContractError("A063_POSTFLIGHT_SOURCE_MANIFEST_MISSING")
    current = {}
    try:
        for rel in source_files:
            if (not isinstance(rel, str) or not rel.startswith("scripts/") or
                    ".." in Path(rel).parts):
                raise contract.ContractError("A063_POSTFLIGHT_SOURCE_MANIFEST_INVALID")
            current[rel] = digest(root / rel)
        emulator_digest = digest(Path(exe).resolve())
    except OSError as exc:
        raise contract.ContractError("A063_POSTFLIGHT_HASH_UNAVAILABLE") from exc
    if (oracle and (planned.get("oracle_driver_symbol") != contract.ORACLE_SYMBOL or
                    planned.get("oracle_bank_entry_expression_count") != 1)):
        raise contract.ContractError("A063_POSTFLIGHT_ORACLE_BINDING_INVALID")
    if (planned.get("schema") != contract.SCHEMA or
            planned.get("trace_action_sha256") != expected_action_sha or
            planned.get("emulator_binary_sha256") != emulator_digest or
            current != source_files or
            planned.get("native_capture_was_executed") is not False or
            planned.get("bank_identity_per_instruction_proven") is not False):
        raise contract.ContractError("A063_POSTFLIGHT_PREFLIGHT_MISMATCH")
    expected_debugger = (
        f"trace {out / 'cpu.trace'},:maincpu,noloop,{planned_action}\ng\n"
    )
    debugger_file = out / "start-debugger.txt"
    try:
        debugger_matches = (debugger_file.is_file() and
                            debugger_file.read_text(encoding="utf-8") == expected_debugger)
    except (OSError, UnicodeError):
        debugger_matches = False
    filenames = {}
    for name in ARTIFACTS:
        file = out / name
        filenames[name] = digest(file) if file.is_file() else None
    reports_valid = False
    if filenames["pretrace-report.json"] and filenames["capabilities.json"]:
        try:
            pre = json.loads((out / "pretrace-report.json").read_text())
            cap = json.loads((out / "capabilities.json").read_text())
            reports_valid = (pre.get("status") == "PRE_INSTRUCTION_FORMAT_PARSED" and
                             pre.get("snapshots", 0) >= 2 and
                             cap.get("status") == "PARTIAL_NATIVE_INSTRUMENTATION")
        except (ValueError, OSError):
            pass
    complete = bool(mame_exit == 0 and debugger_matches and
                    all(filenames.values()) and reports_valid and
                    (identity.get("tracked_tree_clean") if identity is not None
                     else source_identity(root)["tracked_tree_clean"]))
    result = {
        "schema": SCHEMA,
        "status": ("A063_POSTFLIGHT_FILES_BOUND_NOT_PROVENANCE" if complete
                   else "A063_POSTFLIGHT_INCOMPLETE_NOT_PROVENANCE"),
        "private_preflight_sha256": digest(preflight),
        "source_sha256": current,
        "emulator_binary_sha256": emulator_digest,
        "debugger_action_matches_preflight": debugger_matches,
        "artifacts_sha256": filenames,
        "mame_exit_code_observed_by_wrapper": mame_exit,
        "capture_artifacts_complete": complete,
        "emulator_execution_independently_attested": False,
        "native_bank_identity_per_instruction_proven": False,
        "lowbyte_mask_accepted_as_proof": False,
        **(identity if identity is not None else source_identity(root)),
    }
    destination = out / "private-a063-postflight.json"
    try:
        with destination.open("x", encoding="utf-8") as stream:
            json.dump(result, stream, indent=2, sort_keys=True)
            stream.write("\n")
        os.chmod(destination, 0o600)
    except FileExistsError as exc:
        raise contract.ContractError("A063_POSTFLIGHT_EXISTS_PRESERVE_PRIOR_EVIDENCE") from exc
    return result


def verify_postflight(root: Path, output: Path, preflight: Path) -> dict:
    root = root.resolve()
    out = output.resolve()
    private_r2 = (root / "out" / "r2").resolve()
    private_smoke = (root / "out" / "r3" / "a063-smoke").resolve()
    if not (out.is_relative_to(private_r2) or out in (private_smoke, oracle_smoke)):
        raise contract.ContractError("A063_POSTFLIGHT_PRIVATE_CAPTURE_LOCATION_REQUIRED")
    path = out / "private-a063-postflight.json"
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        actual_files = {name: digest(out / name) for name in ARTIFACTS}
    except (ValueError, OSError) as exc:
        raise contract.ContractError("A063_POSTFLIGHT_EVIDENCE_MISSING") from exc
    if (saved.get("schema") != SCHEMA or
            saved.get("status") != "A063_POSTFLIGHT_FILES_BOUND_NOT_PROVENANCE" or
            saved.get("capture_artifacts_complete") is not True or
            saved.get("debugger_action_matches_preflight") is not True or
            saved.get("tracked_tree_clean") is not True or
            saved.get("artifacts_sha256") != actual_files or
            saved.get("private_preflight_sha256") != digest(preflight) or
            any(digest(root / name) != value for name, value in
                saved.get("source_sha256", {}).items()) or
            saved.get("native_bank_identity_per_instruction_proven") is not False):
        raise contract.ContractError("A063_POSTFLIGHT_CHAIN_MISMATCH")
    return {"status": "A063_POSTFLIGHT_CHAIN_INTACT_NOT_BANK_PROVENANCE",
            "native_bank_identity_per_instruction_proven": False}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--preflight", type=Path, required=True)
    p.add_argument("--first")
    p.add_argument("--second")
    p.add_argument("--mame-bin", default="mame")
    p.add_argument("--mame-exit", type=int)
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    try:
        if args.verify:
            result = verify_postflight(ROOT, args.output, args.preflight)
            print("A063_R1_POSTFLIGHT=" + result["status"])
            return
        if args.mame_exit is None or args.first is None or args.second is None:
            raise contract.ContractError("A063_POSTFLIGHT_ARGUMENTS_MISSING")
        result = capture_postflight(ROOT, args.output, args.preflight,
                                    args.first, args.second, args.mame_bin,
                                    args.mame_exit)
    except (contract.ContractError, OSError) as exc:
        p.error(str(exc) if isinstance(exc, contract.ContractError)
                else "A063_POSTFLIGHT_INPUT_INVALID")
    print("A063_R1_POSTFLIGHT=" + result["status"])
    if not result["capture_artifacts_complete"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
