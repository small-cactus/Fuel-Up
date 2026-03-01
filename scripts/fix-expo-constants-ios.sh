#!/bin/sh
set -eu

node <<'EOF'
const fs = require('fs');

const patches = [
  {
    file: './node_modules/expo-constants/scripts/get-app-config-ios.sh',
    from: 'PROJECT_DIR_BASENAME=$(basename $PROJECT_DIR)',
    to: 'PROJECT_DIR_BASENAME=$(basename "$PROJECT_DIR")',
  },
  {
    file: './node_modules/expo-constants/ios/EXConstants.podspec',
    from: String.raw`    :script => "bash -l -c \"#{env_vars}$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\"",`,
    to: String.raw`    :script => 'bash -l -c "\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\""',`,
  },
  {
    file: './ios/Pods/Pods.xcodeproj/project.pbxproj',
    from: String.raw`shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\"";`,
    to: String.raw`shellScript = "bash -l -c \"\\\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\\"\"";`,
  },
];

for (const patch of patches) {
  if (!fs.existsSync(patch.file)) {
    continue;
  }

  const source = fs.readFileSync(patch.file, 'utf8');
  if (!source.includes(patch.from) || source.includes(patch.to)) {
    continue;
  }

  fs.writeFileSync(patch.file, source.replace(patch.from, patch.to));
}
EOF
