#!/usr/bin/env bash
# R2.D2 independent ROM-free toolchain smoke. Does not clone, compile MAME,
# fetch credentials, use a ROM, trigger Actions, or alter any repository.
set -euo pipefail
fail() { printf 'R2D_PREFLIGHT=BLOCKED reason=%s\n' "$1" >&2; exit 2; }
for binary in python3 node git make c++ bash sha256sum; do
  command -v "$binary" >/dev/null || fail "tool_missing_${binary}"
done
python3 - <<'PY' || exit 2
import sys
if sys.version_info < (3,11):
    raise SystemExit("R2D_PREFLIGHT=BLOCKED reason=python_lt_3_11")
PY
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(2)' ||
  fail node_lt_20
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat >"$TMP/smoke.cpp" <<'CPP'
#include <cstdint>
#include <functional>
#include <type_traits>
struct bank { int value; int entry() const {return value;} };
int main() {
  bank b{4};
  const std::function<std::uint64_t()> oracle = [&b]() -> std::uint64_t {
    return b.entry();
  };
  static_assert(std::is_same_v<decltype(oracle()),std::uint64_t>);
  for (int i=0; i<5; ++i) {
    b.value=i;
    if (oracle()!=static_cast<std::uint64_t>(i)) return 3;
  }
  return 0;
}
CPP
c++ -std=c++20 -O0 -Wall -Wextra -Werror "$TMP/smoke.cpp" -o "$TMP/smoke" ||
  fail cxx20_compilation_failed
"$TMP/smoke" || fail oracle_lambda_failed
python3 - <<'PY'
import shutil
space=shutil.disk_usage("/tmp").free
if space < 8*1024**3:
    raise SystemExit("R2D_PREFLIGHT=BLOCKED reason=insufficient_disk_for_mame")
PY
printf 'R2D_PREFLIGHT=PASS_TOOLCHAIN_NOT_MAME_NOT_CHECKOUT\n'
printf 'python=%s\nnode=%s\ncompiler=%s\n' \
  "$(python3 --version)" "$(node --version)" "$(c++ --version | head -n1)"
