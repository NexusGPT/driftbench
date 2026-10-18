#!/bin/zsh
set -eu
# exec preserves the native Claude process as the timeout target; tee records stdout only.
exec "${VERIFY_NATIVE_EXECUTABLE:-claude}" "$@" > >(tee "$VERIFY_NATIVE_RECEIPT")
