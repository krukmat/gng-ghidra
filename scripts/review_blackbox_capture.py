#!/usr/bin/env python3
"""Review an EXISTING Blackbox MAME run without rerunning the game.

Accepts a local folder with capture.avi, input_plan.json, input_timeline.json,
and mame.log. All output stays in ignored out/. Images never go into Git.
A matching Coin/Start input timeline does NOT prove gameplay started.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BUTTONS = frozenset(("coin", "start", "left", "right", "up", "down",
                     "button1", "button2"))
VISUAL_FRAMES = (0, 920, 980, 1060, 1300, 1510, 1660)


def read_frames(path: Path) -> dict[int, frozenset[str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(path.name + " must be an array")
    frames: dict[int, frozenset[str]] = {}
    for n, row in enumerate(raw):
        if not isinstance(row, dict) or not {"frame", "buttons"}.issubset(row):
            raise ValueError(f"{path.name} entry {n}: missing fields")
        frame, buttons = row["frame"], row["buttons"]
        if type(frame) is not int or frame < 0 or frame in frames:
            raise ValueError(f"{path.name} entry {n}: invalid/duplicate frame")
        if not isinstance(buttons, list) or any(
            type(b) is not str or b not in BUTTONS for b in buttons
        ) or len(set(buttons)) != len(buttons):
            raise ValueError(f"{path.name} entry {n}: invalid buttons")
        frames[frame] = frozenset(buttons)
    if not frames:
        raise ValueError(path.name + " contains no frames")
    return frames


def analyze(session: Path) -> dict:
    session = session.expanduser().resolve()
    if not session.is_dir():
        raise ValueError("Blackbox folder missing: " + str(session))
    for name in ("input_plan.json", "input_timeline.json", "mame.log", "capture.avi"):
        if not (session / name).is_file():
            raise ValueError("Missing Blackbox evidence: " + name)
    plan = read_frames(session / "input_plan.json")
    actual = read_frames(session / "input_timeline.json")
    log = (session / "mame.log").read_text(encoding="utf-8", errors="replace")
    stats = {}
    for button in ("coin", "start", "left", "right", "button1", "button2"):
        planned = [f for f, buttons in plan.items() if button in buttons]
        observed = [f for f, buttons in actual.items() if button in buttons]
        stats[button] = {
            "plan_count": len(planned), "actual_count": len(observed),
            "first_planned_frame": min(planned) if planned else None,
            "first_observed_frame": min(observed) if observed else None,
        }
    # Compare only the frames actually recorded. The plan may extend far beyond
    # an interrupted or manually closed session, and keyboard play after the
    # scripted boot is expected and must not be treated as an injection failure.
    boot_differences = []
    for frame, buttons in actual.items():
        if frame < 1505 and buttons != plan.get(frame, frozenset()):
            boot_differences.append(frame)
    faults = (
        "blackbox_harness:input_plan:missing",
        "blackbox_harness:input_plan:invalid_json",
        "blackbox_harness:input_plan:unreadable",
        "blackbox_harness:input_field:missing",
        "blackbox_harness:input_port:missing",
        "blackbox_harness:input_button:unmapped",
    )
    log_faults = [fault for fault in faults if fault in log]
    input_ok = (
        bool(stats["coin"]["actual_count"]) and
        bool(stats["start"]["actual_count"]) and
        bool(stats["coin"]["plan_count"]) and
        bool(stats["start"]["plan_count"]) and
        not boot_differences and not log_faults
    )
    return {
        "schema": "gng.blackbox-session-review.v1",
        "input_gate": "MATCHED" if input_ok else "BLOCKED",
        "gameplay_gate": "VISUAL_UNVERIFIED",
        "rom_state_gate": "NOT_CAPTURED_BY_AVI",
        "video_bytes": (session / "capture.avi").stat().st_size,
        "plan_frames": len(plan),
        "observed_frames": len(actual),
        "last_observed_frame": max(actual),
        "buttons": stats,
        "boot_mismatch_count": len(boot_differences),
        "first_boot_mismatch": min(boot_differences) if boot_differences else None,
        "log_faults": log_faults,
        "log_plan_loaded": "blackbox_harness:input_plan:loaded:" in log,
        "log_start_marker": "blackbox_harness:start" in log,
        "log_stop_marker": "blackbox_harness:stop" in log,
        "video_inspection": "PENDING",
    }


def collect_video(session: Path, dest: Path, report: dict) -> list[tuple[int, str]]:
    if not shutil.which("ffprobe") or not shutil.which("ffmpeg"):
        report["video_inspection"] = "FFMPEG_OR_FFPROBE_MISSING"
        return []
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,avg_frame_rate,nb_frames:format=duration",
         "-of", "json", str(session / "capture.avi")],
        capture_output=True, text=True, timeout=30, check=False,
    )
    if probe.returncode != 0:
        report["video_inspection"] = "VIDEO_UNREADABLE"
        return []
    try:
        metadata = json.loads(probe.stdout)
        stream = metadata["streams"][0]
        report["video"] = {
            "width": int(stream["width"]), "height": int(stream["height"]),
            "avg_frame_rate": stream.get("avg_frame_rate"),
            "duration_seconds": float(metadata.get("format", {}).get("duration") or 0),
        }
        frame_count = int(stream["nb_frames"]) if str(stream.get("nb_frames", "")).isdigit() else None
    except (ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError):
        report["video_inspection"] = "VIDEO_METADATA_INVALID"
        return []
    observed_max = report["last_observed_frame"]
    targets = [f for f in VISUAL_FRAMES if f <= observed_max and
               (frame_count is None or f < frame_count)]
    if not targets:
        report["video_inspection"] = "NO_REVIEW_FRAMES_IN_CAPTURE"
        return []
    dest.mkdir(parents=True, exist_ok=True)
    for stale in dest.glob("frame-*.png"):
        stale.unlink()
    expression = "+".join("eq(n\\," + str(n) + ")" for n in targets)
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(session / "capture.avi"),
        "-vf", "select=" + expression,
        "-vsync", "0", str(dest / "frame-%02d.png"),
    ]
    try:
        rendered = subprocess.run(command, capture_output=True, text=True,
                                  timeout=90, check=False)
    except subprocess.TimeoutExpired:
        report["video_inspection"] = "FFMPEG_TIMEOUT"
        return []
    if rendered.returncode != 0:
        report["video_inspection"] = "FFMPEG_EXTRACT_FAILED"
        return []
    evidence = [(frame, f"frame-{i:02d}.png") for i, frame in enumerate(targets, 1)
                if (dest / f"frame-{i:02d}.png").is_file()]
    report["video_inspection"] = (
        "FRAMES_EXTRACTED_FOR_HUMAN_REVIEW" if len(evidence) == len(targets)
        else "PARTIAL_VIDEO_FRAMES"
    )
    report["video_frame_indices"] = [number for number, _ in evidence]
    return evidence


def write_review(report: dict, out: Path, frames: list[tuple[int, str]]) -> None:
    (out / "summary.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    cards = "".join(
        '<figure><img src="frames/' + html.escape(name) +
        '" width="256" alt="Frame real de MAME"><figcaption>Índice AVI aprox. ' +
        str(index) + "</figcaption></figure>"
        for index, name in frames
    )
    if not cards:
        cards = "<p>No se pudieron extraer fotogramas: comprueba ffmpeg y el AVI.</p>"
    page = (
        '<!doctype html><html lang="es"><meta charset="utf-8">'
        '<title>Blackbox T1 — revisión real</title>'
        '<style>body{background:#111;color:#eee;font:16px system-ui;padding:20px}'
        'section{display:flex;flex-wrap:wrap;gap:12px}figure{margin:4px}'
        'img{image-rendering:pixelated;max-width:100%}figcaption{margin:8px}'
        'code{color:#c9e9ae}</style>'
        '<h1>Blackbox T1 — fotogramas reales del AVI</h1>'
        '<p>Controles verificados: <strong>' + html.escape(report["input_gate"]) +
        '</strong>. ¿Arthur comenzó a jugar? <strong>SIN VERIFICAR VISUALMENTE</strong>.'
        ' Las imágenes son del vídeo existente, no generadas artificialmente.'
        ' Los índices del AVI pueden no corresponder exactamente a los frames de MAME.</p>'
        '<p>Coin observado: ' + str(report["buttons"]["coin"]["actual_count"]) +
        ' frames; Start observado: ' + str(report["buttons"]["start"]["actual_count"]) +
        ' frames. Discrepancias antes de frame 1505: ' +
        str(report["boot_mismatch_count"]) + '</p>'
        '<section>' + cards + '</section></html>'
    )
    (out / "index.html").write_text(page, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=Path, required=True,
                        help="Existing Blackbox folder with the four original files")
    parser.add_argument("--out", type=Path, default=ROOT / "out/blackbox-t1-review")
    parser.add_argument("--no-video", action="store_true", help="Analyze JSON/log only")
    args = parser.parse_args()
    try:
        out = args.out.resolve()
        allowed = (ROOT / "out").resolve()
        if out != allowed and allowed not in out.parents:
            raise ValueError("Output MUST stay inside gitignored gng-ghidra/out/")
        out.mkdir(parents=True, exist_ok=True)
        report = analyze(args.session)
        pictures = [] if args.no_video else collect_video(
            args.session.expanduser().resolve(), out / "frames", report)
        write_review(report, out, pictures)
    except (ValueError, OSError, json.JSONDecodeError,
            subprocess.SubprocessError) as exc:
        parser.error(str(exc))
    print("BLACKBOX_T1_INPUT_GATE=" + report["input_gate"])
    print("BLACKBOX_T1_COIN_FRAMES=" + str(report["buttons"]["coin"]["actual_count"]))
    print("BLACKBOX_T1_START_FRAMES=" + str(report["buttons"]["start"]["actual_count"]))
    print("BLACKBOX_T1_BOOT_MISMATCHES=" + str(report["boot_mismatch_count"]))
    print("BLACKBOX_T1_VIDEO=" + report["video_inspection"])
    print("BLACKBOX_T1_GAMEPLAY=VISUAL_UNVERIFIED")
    print("BLACKBOX_T1_REPORT=" + str(out / "summary.json"))
    print("BLACKBOX_T1_VISUAL=" + str(out / "index.html"))


if __name__ == "__main__":
    main()
