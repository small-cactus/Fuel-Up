const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Requires the Debug app, a configured Home screen, location permission, and Metro.
test('cold launch presents chips only after the measured card and initial camera fit', { timeout: 45000 }, async () => {
    const device = process.env.FUELUP_SIMULATOR_UDID;
    assert.ok(device, 'Set FUELUP_SIMULATOR_UDID to the QA simulator');
    const token = `launch-${Date.now()}`;
    const bundle = 'com.anthonyh.fuelup';
    const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, bundle, 'data'], { encoding: 'utf8' }).trim();
    try { execFileSync('xcrun', ['simctl', 'terminate', device, bundle], { stdio: 'ignore' }); } catch {}
    execFileSync('xcrun', ['simctl', 'launch', device, bundle], {
        env: { ...process.env, SIMCTL_CHILD_FUELUP_MAP_LAUNCH_PROBE: token },
    });
    let report;
    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
        try {
            const value = JSON.parse(readFileSync(path.join(container, 'Documents/map-launch-probe.json'), 'utf8'));
            if (value.token === token) { report = value; break; }
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(report, 'Missing live launch report');
    assert.ok(report.fits.length > 0, 'No station camera fit');
    const first = report.fits[0];
    assert.equal(first.alreadyVisible, false);
    assert.equal(first.contentReady, true);
    assert.ok(first.inset > 100, 'Initial fit ignored the measured station card');
    const visible = report.samples.filter(sample => sample.visible && sample.count > 0);
    assert.ok(visible.length > 0, 'Chips never appeared');
    assert.ok(visible[0].time >= first.time, 'Chips appeared before fitting');
    assert.ok(report.samples.some(sample => sample.ready), 'Map never became launch-ready');
    for (const fit of report.fits.filter(fit => fit.alreadyVisible)) {
        assert.equal(fit.animated, true, 'Visible chips followed by a nonanimated camera jump');
    }
    console.log(`Live startup: ${report.fits.length} fits, first inset ${first.inset}pt, ${visible.length} visible frames`);
});
