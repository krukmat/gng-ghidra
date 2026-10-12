#!/usr/bin/env python3
"""Fail-closed ROM -> real 6809 instruction IR -> structured loop IR -> JS/TS."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import zlib

# MAME src/mame/capcom/gng.cpp: ROM_START(gngb) at 2026-10-12.
ROM_FILES = {
    "gg4.bin": (0x4000, "66606beb"),
    "gg3.bin": (0x8000, "9e01c65e"),
    "gg5.bin": (0x8000, "d6397b2b"),
}
START, END = 0x6002, 0x6014  # real reset routine loop, exclude preceding ORCC.


def read_rom(zip_path: Path) -> tuple[bytes, dict]:
    with zipfile.ZipFile(zip_path) as archive:
        images = {}
        for name, (size, crc) in ROM_FILES.items():
            paths = [p for p in archive.namelist() if p.rsplit('/', 1)[-1].lower() == name]
            if len(paths) != 1:
                raise ValueError(f"Expected one {name} in ZIP, found {len(paths)}")
            data = archive.read(paths[0])
            if len(data) != size or f"{zlib.crc32(data):08x}" != crc:
                raise ValueError(f"{name}: size/CRC mismatch (this POC requires gngb ROM revision)")
            images[name] = data
    flat = bytearray(0x10000)
    flat[0x4000:0x8000] = images["gg4.bin"]
    flat[0x8000:0x10000] = images["gg3.bin"]
    reset = int.from_bytes(flat[0xfffe:0x10000], 'big')
    if reset != 0x6000:
        raise ValueError(f"Reset vector mismatch: 0x{reset:04x} != 0x6000")
    manifest = {
        "schema": "gng.rom-map.v1", "set": "gngb", "cpu": "MC6809", "reset_vector": "0x6000",
        "rom_sha256": {k: hashlib.sha256(v).hexdigest() for k, v in images.items()},
        "ranges": [
            {"start": "0x4000", "end_exclusive": "0x6000", "file": "gg4.bin", "offset": 0, "bank": 4},
            {"start": "0x6000", "end_exclusive": "0x8000", "file": "gg4.bin", "offset": 0x2000, "bank": "fixed"},
            {"start": "0x8000", "end_exclusive": "0x10000", "file": "gg3.bin", "offset": 0, "bank": "fixed"},
            {"start": "0x4000", "end_exclusive": "0x6000", "file": "gg5.bin", "offset": [0, 0x2000, 0x4000, 0x6000], "bank": [0, 1, 2, 3]},
        ],
        "bank_select_register": "0x3e00",
        "sprite_ram": {"start": "0x1e00", "end_exclusive": "0x2000"},
    }
    return bytes(flat), manifest


def lift_reset_loop(image: bytes) -> dict:
    """Decode ONLY supported 6809 forms, rejecting any unfamiliar byte/flow."""
    if len(image) != 65536:
        raise ValueError("Requires 64-KiB flat main CPU memory image")
    pc = START
    instructions = []

    def word(addr):
        return (image[addr] << 8) | image[addr+1]

    while pc < END:
        addr = pc
        op = image[pc]
        if op == 0x8e:  # LDX #imm16
            inst = ("load_imm16", "X", word(pc+1), 3)
        elif op == 0x10 and image[pc+1] == 0x8e:  # LDY #imm16
            inst = ("load_imm16", "Y", word(pc+2), 4)
        elif op == 0xcc:  # LDD #imm16
            inst = ("load_imm16", "D", word(pc+1), 3)
        elif op == 0xed and image[pc+1] == 0x81:  # STD ,X++
            inst = ("store_be16_postinc", "X", "D", 2)
        elif op == 0x31 and image[pc+1] == 0x3f:  # LEAY -1,Y (5-bit indexed)
            inst = ("add_imm16", "Y", -1, 2)
        elif op == 0x26:  # BNE rel8: uses Z from LEAY
            relative = image[pc+1]
            relative = relative if relative < 0x80 else relative - 0x100
            inst = ("branch_not_zero", "CC.Z", (pc+2+relative) & 0xffff, 2)
        else:
            raise ValueError(f"Unsupported opcode in bounded proof at 0x{pc:04X}: 0x{op:02X}")
        kind, dst, arg, width = inst
        pc += width
        if pc > END:
            raise ValueError("Instruction extends beyond permitted routine window")
        instructions.append({
            "address": f"0x{addr:04x}", "raw": image[addr:pc].hex(),
            "op": kind, "dst": dst, "arg": arg, "next": f"0x{pc:04x}"
        })
    if pc != END:
        raise ValueError("Routine length mismatch")
    return {
        "schema": "gng.lir.v1", "cpu": "MC6809", "source_set": "gngb",
        "start": f"0x{START:04x}", "end_exclusive": f"0x{END:04x}",
        "sha256_window": hashlib.sha256(image[START:END]).hexdigest(),
        "instructions": instructions,
    }


def structure(lir: dict) -> dict:
    ins = lir['instructions']
    expected = ["load_imm16", "load_imm16", "load_imm16", "store_be16_postinc",
                "store_be16_postinc", "add_imm16", "branch_not_zero"]
    if [x['op'] for x in ins] != expected:
        raise ValueError('Unexpected control-flow / opcode pattern')
    if ([x['dst'] for x in ins[:3]] != ['X', 'Y', 'D']
        or any(x['dst']!='X' or x['arg']!='D' for x in ins[3:5])
        or ins[5]['dst'] != 'Y' or ins[5]['arg'] != -1
        or ins[6]['arg'] != int(ins[3]['address'], 16)):
        raise ValueError('Unsupported operands / branch target')
    base, count, value = [x['arg'] for x in ins[:3]]
    writes_per_iteration = 2
    byte_count = count * 2 * writes_per_iteration
    if base < 0x1e00 or base + byte_count > 0x2000 or count <= 0:
        raise ValueError('Memory range is not within sprite RAM')
    return {
        "schema": "gng.sir.v1", "kind": "bounded_fill_be16", "region": "sprite_ram",
        "start": base, "iterations": count, "word": value,
        "writes_per_iteration": writes_per_iteration, "stride_bytes": writes_per_iteration * 2,
        "provenance": {"rom_window": [lir['start'], lir['end_exclusive']],
                       "sha256": lir['sha256_window'], "instruction_addresses": [x['address'] for x in ins]},
        "confidence": "mechanically-verified-pattern", "note": "A bounded init loop, not recovered game physics",
    }


def generate_js(sir: dict, typescript=False) -> str:
    if sir['kind'] != 'bounded_fill_be16' or sir['schema'] != 'gng.sir.v1':
        raise ValueError('Unsupported semantic IR')
    typ = ': Uint8Array' if typescript else ''
    export = f"/** Generated from {sir['provenance']['rom_window'][0]}..{sir['provenance']['rom_window'][1]}; do not hand-edit. */\n"
    export += f"/** @param {{Uint8Array}} memory - 64KiB address space (not a renderer) */\n" if not typescript else ''
    export += f"export function initializeSpriteRam(memory{typ}) {{\n"
    export += f"  if (memory.length !== 0x10000) throw new RangeError('expected 64KiB memory');\n"
    export += f"  let x = 0x{sir['start']:04x};\n"
    export += f"  let y = 0x{sir['iterations']:04x};\n"
    export += f"  const d = 0x{sir['word']:04x};\n"
    export += f"  do {{\n"
    export += f"    for (let n = 0; n < {sir['writes_per_iteration']}; n++) {{\n"
    export += f"      memory[x++] = d >>> 8;\n      memory[x++] = d & 0xff;\n"
    export += f"    }}\n    y = (y - 1) & 0xffff;\n"
    export += f"  }} while (y !== 0);\n"
    export += f"  return {{ nextX: x, nextY: y }};\n}}\n"
    return export


def build(zip_path: Path, out: Path):
    flat, manifest = read_rom(zip_path)
    lir = lift_reset_loop(flat)
    sir = structure(lir)
    out.mkdir(parents=True, exist_ok=True)
    def j(name, payload): (out/name).write_text(json.dumps(payload, indent=2, sort_keys=True)+'\n')
    j('rom-map.json', manifest)
    j('reset-loop.lir.json', lir)
    j('reset-loop.sir.json', sir)
    (out/'gngb-flat.bin').write_bytes(flat)
    (out/'sprite-init.mjs').write_text(generate_js(sir))
    (out/'sprite-init.ts').write_text(generate_js(sir, typescript=True))
    print(f"POC PASS: reset={manifest['reset_vector']}, bytes={len(lir['instructions'])} instructions, "
          f"sprite init={sir['iterations']} x {sir['stride_bytes']}={sir['iterations']*sir['stride_bytes']} bytes")
    print(f"Generated in {out}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True, help='Local gngb-compatible gng.zip; never committed')
    parser.add_argument('--out', type=Path, default=Path('out'))
    args = parser.parse_args()
    try: build(args.rom,args.out)
    except (ValueError, zipfile.BadZipFile, OSError) as exc: parser.error(str(exc))

if __name__ == '__main__': main()
