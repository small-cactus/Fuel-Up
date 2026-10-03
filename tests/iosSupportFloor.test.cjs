const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/loadComponent.cjs');
const app = require('../app.json');

test('prebuild keeps iOS 26 as the app and widget minimum', () => {
    const buildProperties = app.expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-build-properties');
    assert.equal(buildProperties[1].ios.deploymentTarget, '26.0');
    const configurations = {
        appDebug: { buildSettings: { IPHONEOS_DEPLOYMENT_TARGET: '15.1' } },
        appRelease: { buildSettings: { IPHONEOS_DEPLOYMENT_TARGET: '26.0' } },
        widget: { buildSettings: { IPHONEOS_DEPLOYMENT_TARGET: '"16.2"', PRODUCT_BUNDLE_IDENTIFIER: 'widget' } },
        comment: 'Release',
    };
    const plugin = load('plugins/withIosBuildCompatibility.js', {
        'expo/config-plugins': {
            withXcodeProject: (config, action) => action(config),
            withDangerousMod: config => config,
        },
    });
    plugin({ modResults: { hash: { project: { objects: { XCBuildConfiguration: configurations } } } } });
    for (const name of ['appDebug', 'appRelease', 'widget']) {
        assert.equal(configurations[name].buildSettings.IPHONEOS_DEPLOYMENT_TARGET, '26.0');
    }
    assert.equal(configurations.widget.buildSettings.PRODUCT_BUNDLE_IDENTIFIER, 'widget');
});
