#!/bin/sh
set -eu
# Argent is a development-only dependency; production installs can omit it.
target=node_modules/@swmansion/argent/dist/tool-server.cjs
[ -f "$target" ] || exit 0
patch_file=patches/argent-simulator-watcher+0.26.0.patch
if ! git apply --reverse --check "$patch_file" >/dev/null 2>&1; then
  git apply --check "$patch_file"
  git apply "$patch_file"
fi
cp scripts/argent/simulator-poll.cjs node_modules/@swmansion/argent/dist/fuelup-simulator-poll.cjs
