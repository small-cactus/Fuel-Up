#!/bin/sh
set -eu

PATCH_FILES="
./patches/@sbaiahmed1+react-native-blur+4.5.7.patch
"

for patch_file in $PATCH_FILES; do
  if [ ! -f "$patch_file" ]; then
    continue
  fi

  if git apply --check "$patch_file" >/dev/null 2>&1; then
    git apply "$patch_file"
  fi
done
