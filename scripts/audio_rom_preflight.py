#!/usr/bin/env python3
"""G5 audio ROM identity check: never outputs ROM bytes or stores derived files."""
import argparse
import hashlib
import json
import sys
import zipfile
import zlib
from pathlib import Path

ROM_NAME = "gg2.bin"
ROM_SIZE = 0x8000
ROM_CRC32 = "615f5b6f"
ROM_SHA1 = "7ef9ec5c2072e21c787a6bbf700033f50c759c1d"


def check_rom(data, size=ROM_SIZE, crc=ROM_CRC32, sha1=ROM_SHA1):
    if not isinstance(data, bytes):
        raise ValueError("AUDIO_ROM_NOT_BYTES")
    return (len(data) == size and f"{zlib.crc32(data) & 0xffffffff:08x}" == crc
            and hashlib.sha1(data).hexdigest() == sha1)


def check_archives(paths):
    found = False
    for path in paths:
        try:
            with zipfile.ZipFile(path) as archive:
                members = [name for name in archive.namelist() if name == ROM_NAME]
                if not members:
                    continue
                found = True
                return "PASS" if check_rom(archive.read(ROM_NAME)) else "MISMATCH"
        except FileNotFoundError:
            continue  # clone set may omit gg2.bin and rely on the parent archive
        except (OSError, zipfile.BadZipFile, RuntimeError):
            return "ARCHIVE_ERROR"
    return "MISSING" if not found else "MISMATCH"


def main(argv=None):
    p = argparse.ArgumentParser(description="Read-only gngb sound ROM check")
    p.add_argument("--rom", type=Path, default=Path("roms/gngb.zip"))
    p.add_argument("--shared", type=Path, default=None,
                   help="Optional parent gng.zip, for ROMs provided by parent set")
    args = p.parse_args(argv)
    paths = [args.rom]
    if args.shared is not None:
        paths.append(args.shared)
    status = check_archives(paths)
    print(json.dumps({"kind": "GNG_AUDIO_ROM_PREFLIGHT_V1", "status": status,
                      "rom": ROM_NAME, "expected_bytes": ROM_SIZE,
                      "mame_rom_identity_verified": status == "PASS"}))
    return 0 if status == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
