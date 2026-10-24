#!/usr/bin/env python3
"""Validate/apply isolated read-only A063 patch to exact MAME mame0289 tag.

Without --apply this checks clean source and patch applicability only.
Does not fetch, build or run MAME and never reads private ROM.
"""
from __future__ import annotations
import argparse
import tempfile
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PATCH=ROOT/"patches/mame0289-a063-bank-oracle.patch"
TARGET="src/mame/capcom/gng.cpp"

def git(mame: Path,*args: str)->str:
    try:
        return subprocess.run(["git","-C",str(mame),*args],text=True,
                              capture_output=True,check=True,timeout=30).stdout.strip()
    except (OSError,subprocess.SubprocessError) as exc:
        raise ValueError("A063_PATCH_GIT_PRECONDITION_FAILED") from exc

def validate(mame: Path)->None:
    if git(mame,"describe","--tags","--exact-match","HEAD")!="mame0289":
        raise ValueError("A063_PATCH_EXACT_TAG_MAME0289_REQUIRED")
    if git(mame,"status","--porcelain","--",TARGET):
        raise ValueError("A063_PATCH_DRIVER_NOT_CLEAN")
    if not (mame/TARGET).is_file() or not PATCH.is_file():
        raise ValueError("A063_PATCH_MISSING_SOURCE_OR_PATCH")
    git(mame,"apply","--check",str(PATCH))


def validate_applied(mame: Path) -> None:
    """Prove the only tracked change equals the exact local patch, byte for byte."""
    if git(mame,"describe","--tags","--exact-match","HEAD")!="mame0289":
        raise ValueError("A063_PATCH_EXACT_TAG_MAME0289_REQUIRED")
    if git(mame,"rev-parse","HEAD")!="f34f02505e32c1993c6a782b6814232cbfc74e36":
        raise ValueError("A063_PATCH_UPSTREAM_COMMIT_MISMATCH")
    if git(mame,"diff","--cached","--name-only"):
        raise ValueError("A063_PATCH_STAGED_CHANGES_FORBIDDEN")
    if git(mame,"diff","--name-only")!=TARGET:
        raise ValueError("A063_PATCH_UNEXPECTED_TRACKED_CHANGES")
    actual=(mame/TARGET).read_bytes()
    try:
        original=subprocess.run(
            ["git","-C",str(mame),"show","HEAD:"+TARGET],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            check=True,timeout=30).stdout
        with tempfile.TemporaryDirectory(prefix="a063-patch-verification-") as tmp:
            expected_path=Path(tmp)/TARGET
            expected_path.parent.mkdir(parents=True,exist_ok=True)
            expected_path.write_bytes(original)
            subprocess.run(["git","-C",tmp,"apply",str(PATCH)],
                           check=True,capture_output=True,timeout=30)
            expected=expected_path.read_bytes()
    except (OSError,subprocess.SubprocessError) as exc:
        raise ValueError("A063_PATCH_VERIFICATION_FAILED") from exc
    if expected!=actual:
        raise ValueError("A063_PATCH_NOT_EXACT_EXPECTED_DRIVER")
    git(mame,"diff","--check")


def main()->None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--mame-source",type=Path,required=True)
    p.add_argument("--apply",action="store_true")
    p.add_argument("--verify-applied",action="store_true")
    args=p.parse_args()
    try:
        mame=args.mame_source.resolve(strict=True)
        if args.apply and args.verify_applied:
            raise ValueError("A063_PATCH_CONFLICTING_MODES")
        if args.verify_applied:
            validate_applied(mame)
            print("A063_PATCH=VERIFIED_EXACT_APPLIED_NOT_COMPILED")
            return
        validate(mame)
        if args.apply:
            git(mame,"apply",str(PATCH))
        print("A063_PATCH="+("APPLIED" if args.apply else "CHECKED")+
              "_SOURCE_ONLY_NOT_COMPILED")
    except (ValueError,OSError) as exc:
        p.error(str(exc) if isinstance(exc,ValueError) else "A063_PATCH_INPUT_INVALID")

if __name__=="__main__":
    main()
