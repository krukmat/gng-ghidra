"""Generate a non-ROM JS artifact to exercise the code generator in public CI."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src'))
from poc import START, END, lift_reset_loop, structure, generate_js
img = bytearray(65536)
# Synthetic 6809 program with same instruction shapes, different operands.
img[START:END] = bytes.fromhex('8e1e20108e0002cc1234ed81ed81313f26f8')
out = Path('out-synthetic')
out.mkdir(exist_ok=True)
(out/'sprite-init.mjs').write_text(generate_js(structure(lift_reset_loop(bytes(img)))))
print('SYNTHETIC_GENERATOR=PASS')
