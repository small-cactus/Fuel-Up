#!/bin/bash
# Incremental, signed Release build; optionally update a paired iPhone in place.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == --help ]]; then
  echo 'Usage: npm run ios:device -- <device-identifier> [--install]'
  echo 'Find the current physical iPhone with: xcrun devicectl list devices'
  exit 0
fi
if [[ $# -lt 1 || $# -gt 2 || "$1" == -* ]]; then
  echo 'Usage: npm run ios:device -- <device-identifier> [--install]' >&2
  exit 2
fi
device_id="$1"
if [[ "${2:-}" != '' && "${2:-}" != --install ]]; then
  echo 'Unknown option. Expected --install.' >&2
  exit 2
fi

if [[ ! -d node_modules || ! -d ios/Pods ]]; then
  echo 'Install project dependencies and CocoaPods before building.' >&2
  exit 1
fi
if ! cmp -s ios/Podfile.lock ios/Pods/Manifest.lock; then
  echo 'Pods are out of sync. Run pod install in ios before building.' >&2
  exit 1
fi

# Reuse the existing warm cache. Never clean or regenerate Pods for a routine build.
derived_data="${FUELUP_DERIVED_DATA:-/tmp/FuelUpGlassDevice}"
jobs="${FUELUP_BUILD_JOBS:-$(sysctl -n hw.physicalcpu)}"
team="${FUELUP_TEAM_ID:-39XZ43SJ93}"
app_path="$derived_data/Build/Products/Release-iphoneos/FuelUp.app"
started=$SECONDS
xcodebuild \
  -workspace ios/FuelUp.xcworkspace \
  -scheme FuelUp \
  -configuration Release \
  -destination "id=$device_id" \
  -derivedDataPath "$derived_data" \
  -parallelizeTargets -jobs "$jobs" \
  -allowProvisioningUpdates \
  -showBuildTimingSummary \
  DEVELOPMENT_TEAM="$team" \
  COMPILER_INDEX_STORE_ENABLE=NO \
  build
echo "Release build completed in $((SECONDS - started)) seconds: $app_path"

# Keep JS bundling enabled, even for native edits, so the installed app is current.
/usr/bin/codesign --verify --deep --strict "$app_path"
if [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app_path/Info.plist")" != com.anthonyh.fuelup ]]; then
  echo 'Unexpected bundle identifier; refusing installation.' >&2
  exit 1
fi
if [[ "${2:-}" == --install ]]; then
  xcrun devicectl device install app --device "$device_id" "$app_path" --timeout 120
  xcrun devicectl device info apps --device "$device_id" \
    --bundle-id com.anthonyh.fuelup --timeout 30
fi
