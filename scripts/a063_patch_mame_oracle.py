#!/usr/bin/env python3
"""Validate/apply isolated read-only A063 patch to exact MAME mame0289 tag.

Without --apply this checks clean source and patch applicability only.
Does not fetch, build or run MAME and never reads private ROM.
"""
from __future__ import annotations
import argparse
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

def main()->None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--mame-source",type=Path,required=True)
    p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    try:
        mame=args.mame_source.resolve(strict=True)
        validate(mame)
        if args.apply:
            git(mame,"apply",str(PATCH))
        print("A063_PATCH="+("APPLIED" if args.apply else "CHECKED")+
              "_SOURCE_ONLY_NOT_COMPILED")
    except (ValueError,OSError) as exc:
        p.error(str(exc) if isinstance(exc,ValueError) else "A063_PATCH_INPUT_INVALID")

if __name__=="__main__":
    main()
