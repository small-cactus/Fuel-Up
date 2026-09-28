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
    assert.equal(report.baseline.filter(view => view.tintScore > 0).length, 1, 'expected exactly one cheapest green price');
    assert.equal(report.baseline.filter(view => view.tintScore < 0).length, 5, 'every alternative should be red');
    const types = new Set(report.events.map(event => event.type));
    for (const type of ['merge-start', 'merge-arrive', 'merge-handoff', 'split-spawn', 'split-handoff', 'merge-impulse', 'split-impulse', 'split-stretch', 'contact-catch']) {
        assert.ok(types.has(type), `missing ${type}`);
    }
    for (const frame of report.samples) {
        assert.ok(frame.viewCount <= frame.stationCount + 1, 'unbounded temporary glass views');
        for (const view of frame.views) {
            assert.ok((view.rebound || 0) <= 18.01, `unbounded rebound: ${view.rebound}pt`);
            assert.ok((view.contactDelay || 0) <= 0.014301, 'contact catch held the flight too long');
            if (view.role !== 'merge') assert.equal(view.contactDelay || 0, 0, 'contact catch affected a split or resting pill');
            assert.ok(Math.hypot(view.reactionX || 0, view.reactionY || 0) <= 36.01, 'unbounded magnetic displacement');
            if (view.baseX != null) {
                assert.ok(Math.hypot(view.x - view.baseX - view.reactionX, view.y - view.baseY - view.reactionY) < 0.001,
                    'visible pill did not follow its physical displacement');
            }
            assert.ok(view.contained, `clipped container edge: ${view.id}`);
            assert.ok(Math.abs(view.tintScore || 0) <= 1, 'unbounded market tint');
            assert.ok(view.tintUpdates <= 20, 'native tint was being recreated every frame');
            assert.ok(Number.isFinite(view.x) && Number.isFinite(view.y), 'invalid rendered position');
        }
    }
    const catches = report.samples.flatMap(frame => frame.views).filter(view => view.contactDelay > 0.001);
    assert.ok(catches.length > 0, 'contact resistance was not sampled on the live map');
    const visibleCatch = Math.max(...catches.map(view => Math.hypot(
        view.x - view.reactionX - view.unresistedX, view.y - view.reactionY - view.unresistedY)));
    assert.ok(visibleCatch > 0.25, 'contact resistance did not affect actual pill movement');
    assert.ok(visibleCatch <= 6.01, 'contact resistance stretched beyond its subtle six-point limit');
    for (const event of report.events.filter(event => event.type === 'contact-catch')) {
        assert.ok(event.duration > 0 && event.duration <= 0.065, 'unbounded contact resistance');
    }
    t.diagnostic(`Visible contact resistance ${visibleCatch.toFixed(2)}pt over ${catches.length} samples`);
    const primaryTravel = Math.max(...report.samples.flatMap(frame => frame.views
        .filter(view => view.primary).map(view => Math.hypot(view.reactionX, view.reactionY))));
    assert.ok(primaryTravel > 4, `main price stayed pinned: ${primaryTravel}pt`);
    for (const event of report.events.filter(event => event.type === 'split-impulse')) {
        assert.ok(event.delta < 0.00001, 'split impulse did not balance across masses');
        assert.ok(event.stretchDuration >= 0.025, 'recoil fired before visible separation');
        assert.ok(event.gap >= 27 || event.arrived, 'recoil fired before the native neck stretched');
    }
    const stretching = report.samples.flatMap(frame => frame.views).filter(view => view.stretchGap > 0 && view.stretchGap < 27);
    assert.ok(stretching.length >= 2, 'no live separated frames before release recoil');
    const releaseGaps = report.events.filter(event => event.type === 'split-impulse').map(event => event.gap);
    assert.ok(releaseGaps.some(gap => gap >= 27), 'all releases bypassed visible stretch');
    t.diagnostic(`Native stretch: ${stretching.length} separated samples before recoil; release gaps ${releaseGaps.map(gap => gap.toFixed(1)).join(', ')}pt`);
    for (const kind of ['merge-impulse', 'split-impulse']) {
        const visibleResponse = report.events.filter(event => event.type === kind).some(event =>
            report.samples.some(frame => frame.time > event.time && frame.time < event.time + 0.3 &&
                frame.views.some(view => view.id === event.owner && Math.hypot(view.reactionX, view.reactionY) > 1)));
        assert.ok(visibleResponse, `${kind} did not move the receiving/remaining price pill`);
    }
    for (const frame of report.samples) {
        for (const badge of frame.views.filter(view => view.role === 'badge')) {
            const primary = frame.views.find(view => view.id === badge.id.slice(6) && view.primary);
            if (primary) assert.equal(badge.tintScore, primary.tintScore, 'count tint did not match its displayed cluster price');
            assert.ok(badge.attachmentOffset >= 56 && badge.attachmentOffset <= 74, 'unbounded connected count stretch');
            if (primary) assert.ok(Math.hypot(badge.x - primary.x - badge.attachmentOffset, badge.y - primary.y) < 0.001,
                'connected price and count did not recoil together');
        }
    }
    t.diagnostic(`Main price recoil ${primaryTravel.toFixed(2)}pt`);
    for (const event of report.events.filter(event => event.type.endsWith('handoff'))) {
        assert.ok(event.delta <= 0.12, `handoff moved ${event.delta}pt`);
    }
    for (const event of report.events.filter(event => event.type === 'split-spawn')) {
        assert.ok(event.delta <= 0.12, `split duplicate jumped away from its stretched count by ${event.delta}pt`);
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

test('connected +1 moves outward before its split is triggered', { timeout: 90000 }, async t => {
    const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
    const token = `pair-${Date.now()}`;
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
    assert.ok(report, 'pair probe did not export');
    assert.equal(report.status, 'completed');
    assert.equal(report.baseline.length, 2);
    assert.equal(report.final.length, 2);
    assert.equal(report.baseline.find(view => view.id === 'lab-0').tintScore, 1);
    assert.ok(report.baseline.find(view => view.id === 'lab-1').tintScore < 0,
        'the more expensive alternative should be red even with only two stations');
    const connected = report.samples.flatMap(frame => frame.views.filter(view => view.role === 'badge'));
    const intermediate = connected.filter(view => view.attachmentOffset > 58 && view.attachmentOffset < 73);
    assert.ok(intermediate.length >= 4, '+1 skipped the visible connected travel phase');
    for (const view of intermediate) {
        assert.equal(view.count, 1);
        assert.equal(view.width, 44);
        assert.equal(view.priceMix, 0);
        assert.ok(view.contained);
    }
    const excursion = Math.max(...connected.map(view => view.attachmentOffset)) - Math.min(...connected.map(view => view.attachmentOffset));
    assert.ok(excursion >= 12, `connected +1 only travelled ${excursion}pt`);
    const splits = report.events.filter(event => event.type === 'split-spawn');
    assert.ok(splits.length >= 2, 'missing repeated pair splits');
    for (const split of splits) {
        const preceding = report.samples.filter(frame => frame.time < split.time)
            .flatMap(frame => frame.views.filter(view => view.role === 'badge')).at(-1);
        assert.ok(preceding && preceding.attachmentOffset >= 68, '+1 detached before visibly pulling away');
        assert.ok(split.delta <= 0.12, 'split did not begin at the stretched +1 location');
    }
    t.diagnostic(`Connected +1 travelled ${excursion.toFixed(2)}pt; ${intermediate.length} intact intermediate frames before split`);
});

test('native map carrier stays attached across long pans and camera jumps', { timeout: 90000 }, async t => {
    const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
    const token = `anchor-${Date.now()}`;
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
    assert.ok(report, 'map carrier probe did not export');
    assert.equal(report.status, 'completed');
    assert.equal(report.stagesCompleted, 11);
    assert.ok(report.anchorSamples.length >= 250, 'insufficient live carrier coverage');
    for (const sample of report.anchorSamples) {
        assert.equal(sample.attached, true, 'MapKit detached the shared glass carrier');
        assert.equal(sample.visible, true, 'MapKit hid or faded the shared glass carrier');
        assert.ok(Number.isFinite(sample.originError) && sample.originError <= 2,
            `carrier rebase displaced the shared glass surface by ${sample.originError}pt`);
    }
    const rebases = report.anchorSamples.at(-1).rebaseCount - report.anchorSamples[0].rebaseCount;
    assert.ok(rebases >= 4, `only ${rebases} carrier rebases were exercised`);
    assert.equal(report.final.length, report.baseline.length, 'camera return lost station views');
    assert.equal(report.final.length, 6);
    const maxError = Math.max(...report.anchorSamples.map(sample => sample.originError));
    t.diagnostic(`${rebases} native carrier rebases; maximum surface offset ${maxError.toFixed(3)}pt`);
});
