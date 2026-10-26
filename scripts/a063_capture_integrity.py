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


def capture_scope(root: Path, out: Path, preflight: Path, planned: dict) -> tuple[bool, bool]:
    """Full oracle is an explicit plan, never inferred from an output path."""
    oracle = planned.get("oracle_mode", False)
    scope = planned.get("oracle_capture_scope")
    full = scope == "full"
    oracle_smoke = (root / "out/r3/a063-oracle-smoke").resolve()
    if (type(oracle) is not bool or scope not in (None, "full") or
            (full and (not oracle or
                       planned.get("capture_output_relative") != contract.FULL_ORACLE_OUTPUT or
                       out != (root / contract.FULL_ORACLE_OUTPUT).resolve() or
                       preflight != (root / contract.FULL_ORACLE_PREFLIGHT).resolve())) or
            (oracle and not full and out != oracle_smoke)):
        raise contract.ContractError("A063_POSTFLIGHT_ORACLE_MODE_INVALID")
    if out == oracle_smoke and not oracle:
        raise contract.ContractError("A063_POSTFLIGHT_ORACLE_REQUIRED")
    if oracle and (planned.get("oracle_driver_symbol") != contract.ORACLE_SYMBOL or
                   planned.get("oracle_bank_entry_expression_count") != 1):
        raise contract.ContractError("A063_POSTFLIGHT_ORACLE_BINDING_INVALID")
    return oracle, full


def full_capture_observed(out: Path, capabilities: dict) -> bool:
    """Require original full-run taps and one observed controlled soft reset.

    These checks bind capture configuration, not bank or bus equivalence. The
    full bank gate separately validates raw trace epoch boundaries and all E.
    """
    if not isinstance(capabilities, dict):
        return False
    try:
        rows = [line.split("\t") for line in
                (out / "observations.tsv").read_text(encoding="utf-8").splitlines()]
    except (OSError, UnicodeError):
        return False
    required = {
        "PROBE": "r2-mame-capability-v1", "DRIVER": "gngb",
        "SPRITE_RAM_TAP_ENABLED": "1", "A04_VIDEO_WRITE_TAP_ENABLED": "1",
        "R36_TARGETED_READ_ENABLED": "1", "R36_UNMAP_POLICY_ENABLED": "1",
        "CONTROLLED_SOFT_RESET_REQUESTED": "1", "OBSERVED_RESET_COUNT": "1",
        "A063_ORACLE_RESET_EPOCH": "1",
    }
    if any([row[1:] for row in rows if row[0] == tag] != [[value]]
           for tag, value in required.items()):
        return False
    chronology = [row[0] for row in rows if row[0] in
                  ("SOFT_RESET_REQUESTED", "RESET_NOTIFICATION")]
    cap = capabilities.get("capabilities")
    return (chronology == ["SOFT_RESET_REQUESTED", "RESET_NOTIFICATION"] and
            isinstance(cap, dict) and
            cap.get("controlled_soft_reset_observed") is True)


def debugger_action_matches(out: Path, action_sha256: str) -> bool:
    """Recheck the actual action during verification, rather than trust a flag."""
    try:
        text = (out / "start-debugger.txt").read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return False
    prefix = f"trace {out / 'cpu.trace'},:maincpu,noloop,"
    suffix = "\ng\n"
    return (text.startswith(prefix) and text.endswith(suffix) and
            hashlib.sha256(text[len(prefix):-len(suffix)].encode()).hexdigest() == action_sha256)


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
    if not isinstance(planned, dict):
        raise contract.ContractError("A063_POSTFLIGHT_PREFLIGHT_INVALID")
    oracle, full = capture_scope(root, out, preflight, planned)
    planned_action = contract.build_action(first, second, oracle=oracle)
    expected_action_sha = hashlib.sha256(planned_action.encode()).hexdigest()
    exe = shutil.which(mame_bin)
    if not exe:
        raise contract.ContractError("A063_POSTFLIGHT_MAME_UNAVAILABLE")
    source_files = planned.get("source_sha256")
    if not isinstance(source_files, dict) or set(source_files) != set(contract.SOURCE_FILES):
        raise contract.ContractError("A063_POSTFLIGHT_SOURCE_MANIFEST_MISSING")
    current = {}
    try:
        for rel in source_files:
            if (not isinstance(rel, str) or rel not in contract.SOURCE_FILES or
                    ".." in Path(rel).parts):
                raise contract.ContractError("A063_POSTFLIGHT_SOURCE_MANIFEST_INVALID")
            current[rel] = digest(root / rel)
        emulator_digest = digest(Path(exe).resolve())
    except OSError as exc:
        raise contract.ContractError("A063_POSTFLIGHT_HASH_UNAVAILABLE") from exc
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
        filenames[name] = digest(file) if file.is_file() and not file.is_symlink() else None
    reports_valid = False
    if filenames["pretrace-report.json"] and filenames["capabilities.json"]:
        try:
            pre = json.loads((out / "pretrace-report.json").read_text())
            cap = json.loads((out / "capabilities.json").read_text())
            reports_valid = (pre.get("status") == "PRE_INSTRUCTION_FORMAT_PARSED" and
                             pre.get("snapshots", 0) >= 2 and
                             cap.get("status") == "PARTIAL_NATIVE_INSTRUMENTATION")
            if full:
                reports_valid = reports_valid and full_capture_observed(out, cap)
        except (ValueError, OSError, TypeError, AttributeError):
            pass
    identity = identity if identity is not None else source_identity(root)
    complete = bool(mame_exit == 0 and debugger_matches and
                    all(filenames.values()) and reports_valid and
                    identity.get("tracked_tree_clean") is True)
    result = {
        "schema": SCHEMA,
        "status": ("A063_POSTFLIGHT_FILES_BOUND_NOT_PROVENANCE" if complete
                   else "A063_POSTFLIGHT_INCOMPLETE_NOT_PROVENANCE"),
        "private_preflight_sha256": digest(preflight),
        "source_sha256": current,
        "emulator_binary_sha256": emulator_digest,
        "trace_action_sha256": expected_action_sha,
        "debugger_action_matches_preflight": debugger_matches,
        "artifacts_sha256": filenames,
        "mame_exit_code_observed_by_wrapper": mame_exit,
        "capture_artifacts_complete": complete,
        "emulator_execution_independently_attested": False,
        "native_bank_identity_per_instruction_proven": False,
        "lowbyte_mask_accepted_as_proof": False,
        **identity,
    }
    if full:
        result["oracle_capture_scope"] = "full"
        result["capture_output_relative"] = contract.FULL_ORACLE_OUTPUT
        result["full_capture_configuration_observed"] = reports_valid
    destination = out / "private-a063-postflight.json"
    try:
        with destination.open("x", encoding="utf-8") as stream:
            json.dump(result, stream, indent=2, sort_keys=True)
            stream.write("\n")
        os.chmod(destination, 0o600)
    except FileExistsError as exc:
        raise contract.ContractError("A063_POSTFLIGHT_EXISTS_PRESERVE_PRIOR_EVIDENCE") from exc
    return result


def verify_postflight(root: Path, output: Path, preflight: Path,
                      *, mame_bin: str | None = None) -> dict:
    root = root.resolve()
    out = output.resolve()
    preflight = preflight.resolve()
    private_r2 = (root / "out" / "r2").resolve()
    private_smoke = (root / "out" / "r3" / "a063-smoke").resolve()
    oracle_smoke = (root / "out" / "r3" / "a063-oracle-smoke").resolve()
    if not (out.is_relative_to(private_r2) or out in (private_smoke, oracle_smoke)):
        raise contract.ContractError("A063_POSTFLIGHT_PRIVATE_CAPTURE_LOCATION_REQUIRED")
    path = out / "private-a063-postflight.json"
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        planned = json.loads(preflight.read_text(encoding="utf-8"))
        actual_files = {name: digest(out / name) if not (out / name).is_symlink() else None
                        for name in ARTIFACTS}
    except (ValueError, OSError) as exc:
        raise contract.ContractError("A063_POSTFLIGHT_EVIDENCE_MISSING") from exc
    if (not isinstance(saved, dict) or not isinstance(planned, dict)
            or planned.get("schema") != contract.SCHEMA
            or not isinstance(saved.get("source_sha256"), dict)
            or planned.get("source_sha256") != saved.get("source_sha256")
            or saved.get("emulator_binary_sha256") != planned.get("emulator_binary_sha256")
            or set(planned.get("source_sha256", {})) != set(contract.SOURCE_FILES)):
        raise contract.ContractError("A063_POSTFLIGHT_PREFLIGHT_BINDING_MISMATCH")
    oracle, full = capture_scope(root, out, preflight, planned)
    if oracle:
        if not mame_bin or not shutil.which(mame_bin):
            raise contract.ContractError("A063_POSTFLIGHT_ORACLE_BINARY_REQUIRED")
        if digest(Path(shutil.which(mame_bin)).resolve()) != saved["emulator_binary_sha256"]:
            raise contract.ContractError("A063_POSTFLIGHT_ORACLE_BINARY_CHANGED")
    if (saved.get("schema") != SCHEMA or
            saved.get("status") != "A063_POSTFLIGHT_FILES_BOUND_NOT_PROVENANCE" or
            saved.get("capture_artifacts_complete") is not True or
            saved.get("debugger_action_matches_preflight") is not True or
            saved.get("tracked_tree_clean") is not True or
            saved.get("artifacts_sha256") != actual_files or
            not all(actual_files.values()) or
            saved.get("private_preflight_sha256") != digest(preflight) or
            not debugger_action_matches(out, planned.get("trace_action_sha256", "")) or
            (saved.get("trace_action_sha256") is not None and
             saved["trace_action_sha256"] != planned.get("trace_action_sha256")) or
            any(digest(root / name) != value for name, value in
                saved.get("source_sha256", {}).items()) or
            saved.get("native_bank_identity_per_instruction_proven") is not False):
        raise contract.ContractError("A063_POSTFLIGHT_CHAIN_MISMATCH")
    if full:
        try:
            cap = json.loads((out / "capabilities.json").read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            raise contract.ContractError("A063_POSTFLIGHT_FULL_CAPTURE_INCOMPLETE") from exc
        if (saved.get("oracle_capture_scope") != "full" or
                saved.get("capture_output_relative") != contract.FULL_ORACLE_OUTPUT or
                saved.get("full_capture_configuration_observed") is not True or
                saved.get("trace_action_sha256") != planned.get("trace_action_sha256") or
                not full_capture_observed(out, cap)):
            raise contract.ContractError("A063_POSTFLIGHT_FULL_CAPTURE_INCOMPLETE")
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
            result = verify_postflight(ROOT, args.output, args.preflight,
                                       mame_bin=args.mame_bin if args.mame_bin != "mame" else None)
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
