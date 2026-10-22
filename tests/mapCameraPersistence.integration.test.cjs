const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('live map preserves camera through location and station updates, while explicit selection still moves it', { timeout: 90000 }, async () => {
    const device = process.env.FUELUP_SIMULATOR_UDID;
    assert.ok(device, 'Set FUELUP_SIMULATOR_UDID to the configured Debug simulator');
    const bundle = 'com.anthonyh.fuelup';
    const token = `camera-${Date.now()}`;
    const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, bundle, 'data'], { encoding: 'utf8' }).trim();
    try { execFileSync('xcrun', ['simctl', 'terminate', device, bundle], { stdio: 'ignore' }); } catch {}
    execFileSync('xcrun', ['simctl', 'launch', device, bundle], {
        env: { ...process.env, SIMCTL_CHILD_FUELUP_MAP_CAMERA_PROBE: token },
    });
    let report;
    const deadline = Date.now() + 80000;
    while (Date.now() < deadline) {
        try {
            const value = JSON.parse(readFileSync(path.join(container, 'Documents/map-camera-probe.json'), 'utf8'));
            if (value.token === token) { report = value; break; }
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(report, 'Missing real MapKit camera report');
    const samples = Object.fromEntries(report.samples.map(s => [s.phase, s]));
    for (const phase of ['overview', 'panned', 'selected']) {
        const a = samples[`${phase}_before`], b = samples[`${phase}_after`];
        assert.ok(a && b, `Missing ${phase} camera coverage`);
        for (const key of ['latitude', 'longitude']) {
            assert.ok(Math.abs(a[key] - b[key]) < 0.000001, `${phase}: location update moved ${key}`);
        }
        assert.ok(Math.abs(a.distance - b.distance) < 0.1, `${phase}: update changed zoom`);
        assert.ok(Math.abs(a.heading - b.heading) < 0.001, `${phase}: update changed heading`);
        assert.ok(Math.abs(a.pitch - b.pitch) < 0.001, `${phase}: update changed pitch`);
    }
    assert.equal(report.selected, true, 'Explicit station selection failed');
    assert.equal(report.showAll, true, 'Explicit overview failed');
    assert.ok(Math.abs(samples.panned_after.distance - samples.selected_before.distance) > 1
        || Math.abs(samples.panned_after.latitude - samples.selected_before.latitude) > 0.00001,
    'Station selection did not change the camera');
    assert.ok(Math.abs(samples.show_all.distance - samples.selected_after.distance) > 1,
        'Show All did not restore overview zoom');
    console.log(JSON.stringify(report));
});
