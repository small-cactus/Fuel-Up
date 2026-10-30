#!/bin/sh
set -eu

# CocoaPods invokes this script from ios/; resolve patches from the repo root.
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

PATCH_FILES="
./patches/expo-router+55.0.12.patch
./patches/expo-widgets-build-paths+55.0.2.patch
./patches/@sbaiahmed1+react-native-blur+4.5.7.patch
"

for patch_file in $PATCH_FILES; do
  if [ ! -f "$patch_file" ]; then
    continue
  fi

  if git apply --reverse --check "$patch_file" >/dev/null 2>&1; then
    continue
  fi

  if git apply --check "$patch_file" >/dev/null 2>&1; then
    git apply "$patch_file"
    continue
  fi

  echo "Failed to apply required patch: $patch_file" >&2
  exit 1
done

sh ./scripts/argent/apply-poll-guard.sh
