const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function migrateAppDelegate(source) {
    if (source.includes('class FuelUpSceneDelegate:')) return source;
    const startup = /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?\n#endif/;
    if (!startup.test(source) || !source.includes('var window: UIWindow?')) {
        throw new Error('Unrecognized Expo AppDelegate; review the scene lifecycle adapter before building.');
    }
    return source.replace('var window: UIWindow?', 'var window: UIWindow?\n  var pendingSceneLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?')
        .replace(startup, '    pendingSceneLaunchOptions = launchOptions') + '\n' +
        fs.readFileSync(path.join(__dirname, 'ios/FuelUpSceneDelegate.swift'), 'utf8');
}
function sceneManifest() {
    return {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{
            UISceneConfigurationName: 'Fuel Up', UISceneClassName: 'UIWindowScene',
            UISceneDelegateClassName: 'FuelUpSceneDelegate',
        }] },
    };
}
module.exports = function withIosSceneLifecycle(config) {
    config = withAppDelegate(config, next => {
        if (next.modResults.language !== 'swift') throw new Error('Fuel Up requires a Swift AppDelegate');
        next.modResults.contents = migrateAppDelegate(next.modResults.contents);
        return next;
    });
    return withInfoPlist(config, next => {
        next.modResults.UIApplicationSceneManifest = sceneManifest();
        return next;
    });
};
module.exports.migrateAppDelegate = migrateAppDelegate;
module.exports.sceneManifest = sceneManifest;
