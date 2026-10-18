#!/bin/zsh
set -eu
VERIFY_ROOT="${0:A:h:h:h}"
exec "$VERIFY_ROOT/node_modules/.bin/tsx" --tsconfig "$VERIFY_ROOT/examples/ledger-verify/tsconfig.json" "$VERIFY_ROOT/examples/ledger-verify/transport.ts" "$@"
