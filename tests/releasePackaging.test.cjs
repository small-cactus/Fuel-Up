const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function compile(file, platform, isDev) {
    return babel.transformFileSync(file, {
        caller: { name: 'metro', bundler: 'metro', platform, isDev, engine: 'hermes' },
    }).code;
}

test('iOS production excludes legacy screens while development retains the real map probe', () => {
    assert(!compile('app/(tabs)/index.js', 'ios', false).includes('require("../../src/screens/LegacyHomeScreen")'));
    assert(compile('app/(tabs)/index.js', 'ios', true).includes('LegacyHomeScreen'));
    assert(compile('app/(tabs)/index.js', 'android', false).includes('LegacyHomeScreen'));
    assert(!compile('src/screens/OnboardingScreen.js', 'ios', false).includes('require("./OnboardingScreen.legacy")'));
    assert(compile('src/screens/OnboardingScreen.js', 'android', false).includes('OnboardingScreen.legacy'));
});

test('native Release configurations optimize widgets without changing Debug', () => {
    const configurations = {
        app: { name: 'Release', buildSettings: {} },
        widget: { name: 'Release', buildSettings: { SWIFT_OPTIMIZATION_LEVEL: '"-Onone"' } },
        debug: { name: 'Debug', buildSettings: { SWIFT_OPTIMIZATION_LEVEL: '"-Onone"' } },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync('plugins/withIosBuildCompatibility.js', 'utf8'), {
        module, require: name => name === 'expo/config-plugins' ? {
            withXcodeProject: (config, apply) => apply(config),
            withDangerousMod: config => config,
        } : require(name),
    });
    module.exports({ modResults: { hash: { project: { objects: { XCBuildConfiguration: configurations } } } } });
    for (const key of ['app', 'widget']) {
        assert.equal(configurations[key].buildSettings.SWIFT_OPTIMIZATION_LEVEL, '"-O"');
        assert.equal(configurations[key].buildSettings.ENABLE_DEBUG_DYLIB, 'NO');
        assert.equal(configurations[key].buildSettings.DEAD_CODE_STRIPPING, 'YES');
    }
    assert.equal(configurations.debug.buildSettings.SWIFT_OPTIMIZATION_LEVEL, '"-Onone"');
    assert.equal(configurations.debug.buildSettings.ENABLE_DEBUG_DYLIB, undefined);
});

test('Release packaging prunes only generated assets and respects skipped bundling', t => {
    const path = require('node:path');
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-release-packaging-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const phase = { name: '"Bundle React Native code and images"', shellScript: JSON.stringify('"$(printf /usr/bin/true)"\n') };
    const config = { modResults: { hash: { project: { objects: {
        PBXShellScriptBuildPhase: { bundle: phase }, XCBuildConfiguration: {},
    } } } } };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync('plugins/withIosBuildCompatibility.js', 'utf8'), {
        module, require: name => name === 'expo/config-plugins' ? {
            withXcodeProject: (value, apply) => apply(value), withDangerousMod: value => value,
        } : require(name),
    });
    module.exports(config);
    const script = phase.shellScript;
    module.exports(config);
    assert.equal(phase.shellScript, script, 'prebuild must be idempotent');
    const assets = path.join(root, 'Fuel Up.app', 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(root, 'keep'), 'keep');
    const run = (configuration, skip = '') => execFileSync('/bin/bash', ['-c', JSON.parse(script)], {
        env: { ...process.env, CONFIGURATION: configuration, CONFIGURATION_BUILD_DIR: root,
            UNLOCALIZED_RESOURCES_FOLDER_PATH: 'Fuel Up.app', SKIP_BUNDLING: skip },
    });
    run('Debug');
    assert(fs.existsSync(assets));
    run('Release', '1');
    assert(fs.existsSync(assets));
    run('Release');
    assert(!fs.existsSync(assets));
    assert.equal(fs.readFileSync(path.join(root, 'keep'), 'utf8'), 'keep');
});
