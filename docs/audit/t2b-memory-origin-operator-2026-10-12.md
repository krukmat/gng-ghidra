# T2.B.7 — Memory proof operator evidence

Date: 2026-10-12
ROM: local gngb image, no ROM files committed.

The operator ran `src/memory_analysis.py` against the Ghidra-exported
14 entry graphs.

| Entrypoint | Memory ops | Statically safe |
|---|---:|---:|
| 0x65c4 | 21 | 0 |
| 0x6000 | 9 | 0 |
| 0x65fb | 3 | 0 |
| 0x6755 | 5 | 0 |
| 0x6772 | 6 | 0 |
| 0x622c | 3 | 0 |
| 0x7930 | 5 | 0 |
| 0x67b3 | 9 | 0 |
| 0x6239 | 10 | 0 |
| 0x6274 | 14 | 0 |
| 0x67db | 80 | 0 |
| 0x6793 | 13 | 0 |
| 0x6812 | 22 | 0 |
| 0x6839 | 17 | 0 |
| **Total** | **217** | **0** |

**Evidence boundary:** zero statically proven-safe operations is not
equivalent to 217 confirmed MMIO touches. No memory or runtime guard
has been relaxed, and no function is behaviorally validated by this
audit. The new per-instruction pointer-origin fingerprint is a
diagnostic follow-up that has not yet been run on the operator's raw
Ghidra export. It identifies required register bounds, not
automatically trusted addresses.
