const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Expo's generated command substitutes an unquoted path, which breaks "Fuel Up".
function quoteBundleCommand(project) {
    for (const phase of Object.values(project.hash.project.objects.PBXShellScriptBuildPhase || {})) {
        if (!phase.shellScript || !String(phase.name).includes('Bundle React Native')) continue;
        const script = JSON.parse(phase.shellScript);
        const next = script.replace(/^`(.+react-native-xcode\.sh.+)`$/m, '"$$($1)"');
        phase.shellScript = JSON.stringify(next);
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
