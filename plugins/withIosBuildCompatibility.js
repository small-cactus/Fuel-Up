const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Expo's generated command substitutes an unquoted path, which breaks "Fuel Up".
function quoteBundleCommand(project) {
    for (const phase of Object.values(project.hash.project.objects.PBXShellScriptBuildPhase || {})) {
        if (!phase.shellScript || !String(phase.name).includes('Bundle React Native')) continue;
        const script = JSON.parse(phase.shellScript);
        const next = script.replace(/^`(.+react-native-xcode\.sh.+)`$/m, '"$$($1)"');
        const packaging = `# Fuel Up Release packaging
if [[ "$CONFIGURATION" == *Release* ]]; then
  export EXTRA_PACKAGER_ARGS="\${EXTRA_PACKAGER_ARGS:-} --minify true"
  if [[ -z "\${SKIP_BUNDLING:-}" ]]; then
    # Metro copies referenced assets but does not remove obsolete ones.
    # This is only the generated asset folder inside the current build product.
    rm -rf "\${CONFIGURATION_BUILD_DIR:?}/\${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/assets"
  fi
fi
`;
        const command = next.lastIndexOf('"$(');
        if (!next.includes('# Fuel Up Release packaging') && command < 0) {
            throw new Error('Cannot locate React Native bundle command for Release packaging');
        }
        phase.shellScript = JSON.stringify(next.includes('# Fuel Up Release packaging')
            ? next : next.slice(0, command) + packaging + next.slice(command));
    }
    return project;
}

const floor = `    # Xcode 27 no longer accepts the old resource-bundle deployment targets.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        deployment = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment && Gem::Version.new(deployment) < Gem::Version.new('15.1')
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        end
      end
    end
`;
module.exports = function withIosBuildCompatibility(config) {
    config = withXcodeProject(config, next => {
        next.modResults = quoteBundleCommand(next.modResults);
        // Apply the app's support floor to its widget target too: expo-widgets
        // otherwise regenerates that target with its own older default.
        for (const configuration of Object.values(next.modResults.hash.project.objects.XCBuildConfiguration || {})) {
            if (!configuration.buildSettings) continue;
            const settings = configuration.buildSettings;
            settings.IPHONEOS_DEPLOYMENT_TARGET = '26.0';
            // expo-widgets generates Release with -Onone, which also enables
            // Xcode's preview/debug dylib. Ship optimized native code instead.
            if (String(configuration.name).replaceAll('"', '') === 'Release') {
                Object.assign(settings, {
                    SWIFT_OPTIMIZATION_LEVEL: '"-O"',
                    SWIFT_COMPILATION_MODE: 'wholemodule',
                    ENABLE_DEBUG_DYLIB: 'NO',
                    DEAD_CODE_STRIPPING: 'YES',
                    COPY_PHASE_STRIP: 'YES',
                    STRIP_INSTALLED_PRODUCT: 'YES',
                    DEPLOYMENT_POSTPROCESSING: 'YES',
                    STRIP_STYLE: '"non-global"',
                });
            }
        }
        return next;
    });
    return withDangerousMod(config, ['ios', async next => {
        const podfile = path.join(next.modRequest.platformProjectRoot, 'Podfile');
        const source = fs.readFileSync(podfile, 'utf8');
        if (!source.includes('# Xcode 27 no longer accepts')) {
            const marker = '  post_install do |installer|\n';
            if (!source.includes(marker)) throw new Error('Cannot locate CocoaPods post_install');
            fs.writeFileSync(podfile, source.replace(marker, marker + floor));
        }
        return next;
    }]);
};
