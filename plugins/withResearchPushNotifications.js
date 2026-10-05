const { withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist');
const targetName = 'FuelUpNotificationService';

function configure(project, root, version = '1.0.0', build = '1') {
  const folder = path.join(root, targetName);
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'ios/FuelUpNotificationService.swift'), path.join(folder, 'NotificationService.swift'));
  fs.copyFileSync(path.join(__dirname, '../modules/fuel-up-driving-activity/ios/Resources/fuelup-test-blue.png'), path.join(folder, 'fuelup-test-blue.png'));
  fs.writeFileSync(path.join(folder, `${targetName}-Info.plist`), plist.default.build({
    CFBundleDisplayName: 'Fuel Up', CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)', CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: '$(PRODUCT_NAME)', CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: version, CFBundleVersion: build,
    NSExtension: { NSExtensionPointIdentifier: 'com.apple.usernotifications.service', NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).NotificationService' },
  }));
  const targets = project.pbxNativeTargetSection();
  let uuid = Object.keys(targets).find(key => targets[key]?.name?.replaceAll('"', '') === targetName);
  if (!uuid) {
    uuid = project.addTarget(targetName, 'app_extension', targetName, 'com.anthonyh.fuelup.notifications').uuid;
    project.addBuildPhase([`${targetName}/NotificationService.swift`], 'PBXSourcesBuildPhase', 'Sources', uuid);
    project.addBuildPhase([`${targetName}/fuelup-test-blue.png`], 'PBXResourcesBuildPhase', 'Resources', uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', uuid);
  }
  const configs = project.pbxXCConfigurationList()[targets[uuid].buildConfigurationList].buildConfigurations;
  for (const { value } of configs) {
    const settings = project.pbxXCBuildConfigurationSection()[value].buildSettings;
    Object.assign(settings, {
      DEVELOPMENT_TEAM: '39XZ43SJ93', CODE_SIGN_STYLE: 'Automatic',
      IPHONEOS_DEPLOYMENT_TARGET: '26.0', SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"', SKIP_INSTALL: 'YES',
      APPLICATION_EXTENSION_API_ONLY: 'YES', GENERATE_INFOPLIST_FILE: 'NO',
      SWIFT_OPTIMIZATION_LEVEL: '"-O"', COPY_PHASE_STRIP: 'YES', DEAD_CODE_STRIPPING: 'YES',
    });
  }
  return project;
}
module.exports = function withResearchPushNotifications(config) {
  return withXcodeProject(config, next => {
    configure(next.modResults, next.modRequest.platformProjectRoot, config.version, config.ios?.buildNumber);
    return next;
  });
};
module.exports.configure = configure;
