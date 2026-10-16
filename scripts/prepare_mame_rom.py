#!/usr/bin/env python3
"""Identify a *local* GNG/GNGB ZIP by actual ROM contents (not ZIP filename).

MAME requires a set named gngb.zip for its gngb driver even when an earlier
Python/Ghidra flow used a custom gng.zip filename. This script verifies the
real CPU ROM revision by size/CRC, then creates only a symlink inside
ignored out/reference/mame-roms. It does NOT modify, copy or download ROMs.
Missing sound/PROM/PLD are disclosed before attempting to launch MAME.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from graphics_preview import PARTS as GRAPHICS  # noqa: E402

SCHEMA = "gng.mame-rom-preflight.v1"
# Official Capcom GNG MAME driver, src/mame/capcom/gng.cpp
CORE = {
    "gngb": {
        "gg4.bin": (0x4000, 0x66606beb),
        "gg3.bin": (0x8000, 0x9e01c65e),
        "gg5.bin": (0x8000, 0xd6397b2b),
    },
    "gng": {
        "mm_c_04": (0x4000, 0x4f94130f),
        "mm_c_03": (0x8000, 0x1def138a),
        "mm_c_05": (0x8000, 0xed28e86e),
    },
}
AUXILIARY = {
    "gg2.bin": (0x8000, 0x615f5b6f),  # Z80 audio CPU
    "tbp24s10.14k": (0x100, 0x0eaf5158),
    "63s141.2e": (0x100, 0x4a1285a4),
    "gg-pal10l8.bin": (0x2c, 0x87f1b7e0),
}


def _zip_entries(archive: zipfile.ZipFile) -> dict[str, bytes]:
    contents = {}
    for name in archive.namelist():
        if name.endswith("/"):
            continue
        short = name.rsplit("/", 1)[-1].casefold()
        if short in contents:
            raise ValueError("Duplicate ROM entry basename: " + short)
        contents[short] = archive.read(name)
    return contents


def _match(entries: dict[str, bytes], requirement: dict[str, tuple[int, int]]):
    missing, wrong, valid = [], [], {}
    for filename, (size, crc) in requirement.items():
        data = entries.get(filename.casefold())
        if data is None:
            missing.append(filename)
        elif len(data) != size or zlib.crc32(data) != crc:
            wrong.append({"file": filename, "actual_bytes": len(data),
                          "actual_crc32": f"{zlib.crc32(data):08x}",
                          "expected_bytes": size, "expected_crc32": f"{crc:08x}"})
        else:
            valid[filename] = hashlib.sha256(data).hexdigest()
    return missing, wrong, valid


def inspect_archive(source: Path) -> dict:
    with zipfile.ZipFile(source) as z:
        entries = _zip_entries(z)
    candidates = []
    for set_name, core_files in CORE.items():
        missing, wrong, valid = _match(entries, core_files)
        candidates.append({"machine": set_name, "missing": missing,
                           "wrong": wrong, "valid": valid})
    matches = [c for c in candidates if not c["missing"] and not c["wrong"]]
    if len(matches) != 1:
        raise ValueError(
            "Cannot uniquely identify gng/gngb program ROMs by CRC; " +
            json.dumps([{k: x[k] for k in ("machine", "missing", "wrong")}
                        for x in candidates]))
    machine = matches[0]["machine"]
    graphics = {name: (length, crc) for name, (length, crc, _, _) in GRAPHICS.items()}
    missing_graphics, wrong_graphics, graphics_sha = _match(entries, graphics)
    missing_aux, wrong_aux, aux_sha = _match(entries, AUXILIARY)
    report = {
        "schema": SCHEMA, "machine": machine,
        "source_file": str(source.resolve()),
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "program_sha256": matches[0]["valid"],
        "graphics_sha256": graphics_sha,
        "auxiliary_sha256": aux_sha,
        "missing_graphics": missing_graphics,
        "invalid_graphics": wrong_graphics,
        "missing_auxiliary": missing_aux,
        "invalid_auxiliary": wrong_aux,
        "set_complete": not (missing_graphics or wrong_graphics or
                             missing_aux or wrong_aux),
    }
    return report


def prepare(source: Path, out: Path) -> dict:
    source = source.resolve(strict=True)
    if not source.is_file():
        raise ValueError("Not a local ROM ZIP: " + str(source))
    out = out.resolve()
    if out != ROOT / "out" and (ROOT / "out") not in out.parents:
        raise ValueError("The MAME set alias must live inside ignored out/")
    report = inspect_archive(source)
    if not report["set_complete"]:
        # Other archives can be supplied by the owner later, but never
        # invent or silently substitute copyrighted chip contents.
        report["status"] = "BLOCKED_MISSING_REQUIRED_CHIPS"
        return report
    out.mkdir(parents=True, exist_ok=True)
    alias = out / (report["machine"] + ".zip")
    if alias.is_symlink():
        if alias.resolve() != source:
            alias.unlink()
            alias.symlink_to(source)
    elif alias.exists():
        # Do not overwrite a real file, even in ignored out/.
        raise ValueError("Refusing to overwrite existing MAME set: " + str(alias))
    else:
        alias.symlink_to(source)
    report["mame_rompath"] = str(out)
    report["mame_set_alias"] = str(alias)
    report["status"] = "READY_FOR_NATIVE_MAME_CAPTURE"
    manifest = out / "rom-set.json"
    manifest.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom", type=Path, default=Path("roms/gng.zip"),
                        help="Your existing private ZIP, irrespective of its name")
    parser.add_argument("--out", type=Path, default=ROOT / "out/reference/mame-roms")
    args = parser.parse_args()
    try:
        report = prepare(args.rom, args.out)
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        parser.error(str(exc))
    print("GNG_MAME_SET_PREFLIGHT=" + report["status"] + " machine=" +
          report["machine"])
    if report["status"] != "READY_FOR_NATIVE_MAME_CAPTURE":
        for key in ("missing_graphics", "invalid_graphics",
                    "missing_auxiliary", "invalid_auxiliary"):
            if report[key]:
                print("  " + key + "=" + json.dumps(report[key]))
        print("GNG_MAME_CAPTURE=BLOCKED no ROM synthesized/downloaded")
        raise SystemExit(2)
    print("GNG_MAME_ROM_ALIAS=" + report["mame_set_alias"])
    print("GNG_MAME_ORIGINAL_UNCHANGED=" + report["source_file"])


if __name__ == "__main__":
    main()
