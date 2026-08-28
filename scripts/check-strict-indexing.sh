#!/bin/sh
# Balancia — strict index access, for the modules where an off-by-one is money.
#
# `noUncheckedIndexedAccess` is off in tsconfig.json, and turning it on across
# the repository reports 834 problems — the bulk of them in the image and OCR
# kernels, where the honest fix is a non-null assertion that adds no safety and
# the dishonest one is the same assertion without the thought. Not a useful
# trade, and not a change anybody would review.
#
# The money and session modules are a different matter: there an index that is
# quietly `undefined` reaches an amount, a balance or an identity. Those
# directories are held to the stricter rule, and this is what holds them.
#
# TypeScript reports diagnostics for the whole program rather than only the
# files a config includes, so `tsconfig.strict-indexing.json` narrowing the
# entry points is not enough on its own — everything they import comes along.
# Hence the filter: the guarded paths must be clean, and what their imports do
# is tsconfig.json's business, not this script's.
set -u

GUARDED='^src/(modules/(balances|currencies|expenses|settlements)|lib/security)/'

# tsc exits non-zero whenever it reports anything, including the imported-file
# diagnostics this script is about to discard, so its status is not the answer.
output=$(pnpm exec tsc --noEmit -p tsconfig.strict-indexing.json 2>&1 || true)

# Tests are excluded on purpose. A fixture indexed past its end fails as a
# test, immediately and by name, which is the feedback this rule exists to
# provide everywhere else.
violations=$(printf '%s\n' "$output" | grep -E "$GUARDED" | grep -v '\.test\.' || true)

if [ -n "$violations" ]; then
  echo "Unchecked index access in a guarded module:" >&2
  echo >&2
  printf '%s\n' "$violations" >&2
  echo >&2
  echo "Each of these reads an array or record slot that may hold nothing." >&2
  echo "Narrow it, or say why it cannot be empty and fail loudly if it is." >&2
  exit 1
fi

echo "Guarded modules are clean under noUncheckedIndexedAccess."
