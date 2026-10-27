#!/usr/bin/env python3
"""Extract only a hash-verified, privately owned Z80 ROM to ignored out/audio."""
import argparse
import hashlib
import json
import sys
import zipfile
import zlib
from pathlib import Path

NAME="gg2.bin"
SIZE=0x8000
CRC="615f5b6f"
SHA1="7ef9ec5c2072e21c787a6bbf700033f50c759c1d"

def valid(data):
    return (len(data)==SIZE and f"{zlib.crc32(data)&0xffffffff:08x}"==CRC
            and hashlib.sha1(data).hexdigest()==SHA1)

def extract(paths, dest):
    if dest.resolve().is_relative_to(Path.cwd().resolve()) is False:
        raise ValueError("AUDIO_OUTPUT_OUTSIDE_CHECKOUT")
    if not dest.as_posix().startswith("out/audio/"):
        raise ValueError("AUDIO_ROM_PRIVATE_OUTPUT_REQUIRED")
    for filename in paths:
        if not filename.exists():
            continue
        with zipfile.ZipFile(filename) as archive:
            if NAME not in archive.namelist():
                continue
            data=archive.read(NAME)
        if not valid(data):
            raise ValueError("AUDIO_ROM_WRONG_IDENTITY")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return True
    raise ValueError("AUDIO_ROM_NOT_FOUND")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--rom",type=Path,default=Path("roms/gngb.zip"))
    p.add_argument("--shared",type=Path,default=Path("roms/gng.zip"))
    p.add_argument("--out",type=Path,default=Path("out/audio/gg2.bin"))
    a=p.parse_args()
    try:
        extract([a.rom,a.shared],a.out)
    except (ValueError,OSError,zipfile.BadZipFile) as e:
        print(json.dumps({"kind":"GNG_AUDIO_PRIVATE_Z80_ROM","status":"STOP",
                          "error":type(e).__name__}))
        return 2
    print(json.dumps({"kind":"GNG_AUDIO_PRIVATE_Z80_ROM","status":"IDENTITY_PASS",
                      "rom":NAME,"bytes":SIZE,"path_is_private":True}))
    return 0

if __name__=="__main__":
    sys.exit(main())
