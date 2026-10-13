#!/bin/zsh
set -eu
VERIFY_ROOT="${0:A:h:h:h}"
exec python3 "$VERIFY_ROOT/examples/ledger-verify/transport-retry.py" "$@"
