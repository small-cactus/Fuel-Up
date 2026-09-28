const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('Swift Glass Lab renders timely transitions and preserves native container geometry', { timeout: 90000 }, async t => {
    const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
    const token = `native-${Date.now()}`;
    const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, 'com.anthonyh.fuelup', 'data'], { encoding: 'utf8' }).trim();
    const file = path.join(container, 'Documents/cluster-lab-probe.json');
    execFileSync('xcrun', ['simctl', 'openurl', device, `fuelup:///cluster-lab?clusterLabProbe=${token}`]);
    let report;
    const deadline = Date.now() + 75000;
    while (Date.now() < deadline) {
        try {
            const value = JSON.parse(readFileSync(file, 'utf8'));
            if (value.token === token) { report = value; break; }
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(report, `Native probe did not export ${file}`);
    assert.equal(report.status, 'completed');
    assert.equal(report.usesNativeGlass, true);
    assert.equal(report.stagesCompleted, 11);
    assert.ok(report.samples.length >= 250, 'insufficient live frame coverage');
    const types = new Set(report.events.map(event => event.type));
    for (const type of ['merge-start', 'merge-arrive', 'merge-handoff', 'split-spawn', 'split-handoff']) {
        assert.ok(types.has(type), `missing ${type}`);
    }
    for (const frame of report.samples) {
        assert.ok(frame.viewCount <= frame.stationCount + 1, 'unbounded temporary glass views');
        for (const view of frame.views) {
            assert.ok((view.rebound || 0) <= 18.01, `unbounded rebound: ${view.rebound}pt`);
            assert.ok(view.contained, `clipped container edge: ${view.id}`);
            assert.ok(Number.isFinite(view.x) && Number.isFinite(view.y), 'invalid rendered position');
        }
    }
    for (const event of report.events.filter(event => event.type.endsWith('handoff'))) {
        assert.ok(event.delta <= 0.12, `handoff moved ${event.delta}pt`);
    }
    const arrivals = report.events.filter(event => event.type === 'merge-arrive' || event.type === 'split-handoff');
    for (const event of arrivals) {
        assert.ok(event.duration <= 0.30, `transition trailed the gesture: ${event.duration}s`);
    }
    const maxRebound = Math.max(...report.samples.flatMap(frame => frame.views.map(view => view.rebound || 0)));
    assert.ok(maxRebound > 3, 'large/quick moves did not show stronger rendered rebound');
    t.diagnostic(`Maximum rendered rebound ${maxRebound.toFixed(2)}pt`);
    const maxDuration = Math.max(...arrivals.map(event => event.duration));
    const maxStep = Math.max(...report.samples.flatMap(frame => frame.views.map(view => view.step || 0)));
    t.diagnostic(`Longest transition ${Math.round(maxDuration * 1000)}ms; maximum measured travel ${maxStep.toFixed(2)}pt/frame`);
    assert.equal(report.baseline.length, 6, 'initial fixture did not fully separate');
    assert.equal(report.final.length, 6, 'reset fixture did not fully separate');
    const final = new Map(report.final.map(view => [view.id, view]));
    for (const before of report.baseline) {
        const after = final.get(before.id);
        assert.ok(after, `reset lost ${before.id}`);
        assert.ok(Math.hypot(before.x - after.x, before.y - after.y) <= 1.5, `reset moved ${before.id}`);
    }
    t.diagnostic(`${report.samples.length} native frames; ${report.events.length} transitions; ${file}`);
});
