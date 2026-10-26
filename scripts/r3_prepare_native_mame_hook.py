#!/usr/bin/env python3
"""Prepare a private, fail-closed MAME core overlay instrumenting true 6809 lines.

The official Homebrew MAME binary is not modified. Supply a separately
obtained MAME source tree with --mame-source; this creates patched COPIES
under ignored out/r3/native-mame-overlay. Nothing is built or installed.
The build/runtime evidence gate must run on the patched binary, not stock
MAME. Requires matching anchors in current upstream MAME source.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Matching the emitted lines of the actual MAME 6809 implementation is
# deliberate. Fail rather than silently instrumenting a different CPU core.
CPU_SRC = Path("src/devices/cpu/m6809/m6809.cpp")
MICROCODE_SRC = Path("src/devices/cpu/m6809/base6x09.lst")
PREFIX = "GNG_R35_NATIVE_V1"


def replace_once(text: str, old: str, new: str, stage: str) -> str:
    if text.count(old) != 1:
        raise ValueError(f"R35_MAME_ANCHOR_MISMATCH_{stage}")
    return text.replace(old, new, 1)


def mame_snippet(block: str) -> str:
    """Re-indent a 4-space snippet with one tab per level, as MAME does.

    MAME builds with -Wall -Werror. The first T4.2 build failed because
    space-indented, unbraced guards spliced into tab-indented code tripped
    -Werror=misleading-indentation, so every guard here is braced as well.
    """
    lines = []
    for line in block.strip("\n").split("\n"):
        body = line.lstrip(" ")
        depth, partial = divmod(len(line) - len(body), 4)
        if partial or body.startswith("\t"):
            raise ValueError("R35_MAME_SNIPPET_INDENT")
        lines.append("\t" * depth + body)
    return "\n".join(lines) + "\n"


def instrument_cpu(source: str) -> str:
    anchor = (
        "void m6809_base_device::execute_set_input(int inputnum, int state)\n"
        "{\n"
    )
    logger = mame_snippet(r'''
    if (std::string_view(machine().system().name) == "gngb" &&
            (inputnum == M6809_IRQ_LINE ||
            inputnum == M6809_FIRQ_LINE ||
            inputnum == INPUT_LINE_NMI))
    {
        logerror("GNG_R35_NATIVE_V1\tLINE_DELIVERED\t%s\t%d\t%04X\t%02X\t%llu\n",
                inputnum_string(inputnum), state != CLEAR_LINE,
                unsigned(m_pc.w), unsigned(m_cc),
                (unsigned long long)total_cycles());
    }
''')
    source = replace_once(source, anchor, anchor + logger, "INPUT_CALLBACK")
    anchor = (
        "\tm_cc |= CC_F;       // FIRQ disabled\n"
    )
    # Device reset also happens at cold power-on. This is a CPU reset
    # boundary only, not a proof of its external origin.
    reset = mame_snippet(r'''
    if (std::string_view(machine().system().name) == "gngb")
    {
        logerror("GNG_R35_NATIVE_V1\tCPU_RESET\t%llu\n",
                (unsigned long long)total_cycles());
    }
''')
    return replace_once(source, anchor, anchor + reset, "CPU_RESET")


def instrument_microcode(source: str) -> str:
    # m6809make.py splits statements at ';' and treats a leading '%' or '@'
    # as dispatch/cycle markers: snippets keep ';' last and start with 'if'.
    # base6x09.lst is also included by hd6309.lst and konami.lst.
    entry = mame_snippet(r'''
    if (std::string_view(machine().system().name) == "gngb")
    {
        logerror("GNG_R35_NATIVE_V1\tSYNC_ENTER\t%04X\t%02X\t%llu\n",
                unsigned((m_pc.w - 1) & 0xffff), unsigned(m_cc),
                (unsigned long long)total_cycles());
    }
''')
    exit_event = mame_snippet(r'''
    if (std::string_view(machine().system().name) == "gngb")
    {
        logerror("GNG_R35_NATIVE_V1\tSYNC_EXIT\t%04X\t%02X\t%d\t%d\t%d\t%llu\n",
                unsigned(m_pc.w), unsigned(m_cc), int(m_irq_line),
                int(m_firq_line), int(m_nmi_asserted),
                (unsigned long long)total_cycles());
    }
''')
    old = "\tm_syncack_write_func(1);\n"
    source = replace_once(source, old, old + entry, "SYNC_ENTER")
    old = "\tm_syncack_write_func(0);\n"
    source = replace_once(source, old, old + exit_event, "SYNC_EXIT")
    for line in ("IRQ", "FIRQ", "NMI"):
        anchor = "\n" + line + ":\n"
        callback = mame_snippet(r'''
    if (std::string_view(machine().system().name) == "gngb")
    {
        logerror("GNG_R35_NATIVE_V1\tIRQ_ENTRY\t''' + line + r'''\t%04X\t%02X\t%llu\n",
                unsigned(m_pc.w), unsigned(m_cc),
                (unsigned long long)total_cycles());
    }
''')
        source = replace_once(source, anchor, anchor + callback, line + "_ENTRY")
    old = "\t@m_pc.b.l = read_vector(1);\n"
    callback = mame_snippet(r'''
    if (std::string_view(machine().system().name) == "gngb")
    {
        logerror("GNG_R35_NATIVE_V1\tVECTOR_FETCH\t%04X\t%04X\t%llu\n",
                unsigned(m_ea.w), unsigned(m_pc.w),
                (unsigned long long)total_cycles());
    }
''')
    source = replace_once(source, old, old + callback, "VECTOR_FETCH")
    return source


def prepare(source_root: Path, output: Path) -> dict:
    allowed = (ROOT / "out" / "r3").resolve()
    dest = output.resolve()
    if not dest.is_relative_to(allowed):
        raise ValueError("R35_MAME_OUTPUT_MUST_STAY_INSIDE_PRIVATE_OUT_R3")
    if dest == allowed:
        raise ValueError("R35_MAME_NEEDS_SUBDIRECTORY")
    if not source_root.is_dir():
        raise ValueError("R35_MAME_SOURCE_DIR_MISSING")
    jobs = ((CPU_SRC, instrument_cpu), (MICROCODE_SRC, instrument_microcode))
    results = []
    for relative, patch in jobs:
        src = (source_root / relative)
        if not src.is_file():
            raise ValueError(f"R35_MAME_UPSTREAM_FILE_MISSING_{relative.name}")
        before = src.read_text(encoding="utf8")
        after = patch(before)
        destination = dest / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and destination.read_text(encoding="utf8") != after:
            raise ValueError("R35_MAME_REFUSES_STALE_OVERLAY:" + str(relative))
        if not destination.exists():
            destination.write_text(after, encoding="utf8")
        results.append({
            "path": str(relative),
            "upstream_sha256": hashlib.sha256(before.encode()).hexdigest(),
            "instrumented_sha256": hashlib.sha256(after.encode()).hexdigest(),
            "contains_native_marker": PREFIX in after
        })
    manifest = {
        "schema": "gng.r3.native-mame-6809-overlay.v1",
        "status": "PATCHED_SOURCE_ONLY_BINARY_NOT_VERIFIED",
        "output_directory": str(dest),
        "files": results,
        "binary_built": False,
        "native_signal_events_captured": False,
        "native_irq_entry_verified": False,
        "boot_cpu_or_sync_equivalence_verified": False,
        "events": ["CPU_RESET", "LINE_DELIVERED", "SYNC_ENTER", "SYNC_EXIT",
                   "IRQ_ENTRY", "VECTOR_FETCH"],
        "important": (
            "Build a private MAME executable from these instrumented sources; "
            "run gngb with -oslog into private out/ logs. "
            "Do not accept stock-MAME or fixture-generated native events."
        ),
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mame-source", type=Path, required=True)
    parser.add_argument("--out", type=Path,
                        default=ROOT / "out/r3/native-mame-overlay")
    args = parser.parse_args()
    try:
        manifest = prepare(args.mame_source, args.out)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps({
        "status": manifest["status"],
        "patch_count": len(manifest["files"]),
        "native_irq_entry_verified": False,
        "binary_built": False
    }, indent=2))


if __name__ == "__main__":
    main()
