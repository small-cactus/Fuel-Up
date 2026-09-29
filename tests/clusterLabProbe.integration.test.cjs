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
        assert.ok(frame.glassGroupCount > 0 && frame.glassGroupCount <= frame.viewCount, 'unbounded native effect groups');
        for (const view of frame.views) {
            assert.ok((view.rebound || 0) <= 18.01, `unbounded rebound: ${view.rebound}pt`);
            assert.ok((view.contactDelay || 0) <= 0.014301, 'contact catch held the flight too long');
            if (view.role !== 'merge') assert.equal(view.contactDelay || 0, 0, 'contact catch affected a split or resting pill');
            assert.ok(Math.hypot(view.reactionX || 0, view.reactionY || 0) <= 36.01, 'unbounded magnetic displacement');
            if (view.baseX != null) {
                assert.ok(Math.hypot(view.x - view.baseX - view.reactionX, view.y - view.baseY - view.reactionY - (view.clearanceY || 0)) < 0.001,
                    'visible pill did not follow its physical displacement');
            }
            assert.ok(view.contained, `clipped container edge: ${view.id}`);
            if (view.priceMix > 0.5) assert.equal(view.tintScore, report.marketScores[view.id],
                `visible price ${view.id} changed its global tint during zoom/merge`);
            assert.ok(Math.abs(view.clearanceY || 0) <= 32, 'location avoidance moved a station too far');
            assert.ok(Math.abs(view.tintScore || 0) <= 1, 'unbounded market tint');
            assert.ok(view.tintUpdates <= 20, 'native tint was being recreated every frame');
            assert.ok(Number.isFinite(view.x) && Number.isFinite(view.y), 'invalid rendered position');
        }
    }
    const catches = report.samples.flatMap(frame => frame.views).filter(view => view.contactDelay > 0.001);
    assert.ok(catches.length > 0, 'contact resistance was not sampled on the live map');
    const visibleCatch = Math.max(...catches.map(view => Math.hypot(
        view.x - view.reactionX - view.unresistedX, view.y - view.reactionY - (view.clearanceY || 0) - view.unresistedY)));
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
            if (primary) {
                assert.equal(badge.tintScore, primary.tintScore, 'count tint did not match its displayed cluster price');
                assert.equal(badge.glassGroup, primary.glassGroup, 'horizontal count lost its shared native effect');
            }
            assert.ok(badge.attachmentOffset >= 56 && badge.attachmentOffset <= 74, 'unbounded connected count stretch');
            if (primary) assert.ok(Math.hypot(badge.x - primary.x - badge.attachmentOffset, badge.y - primary.y) < 0.001,
                'connected price and count did not recoil together');
        }
    }
    t.diagnostic(`Main price recoil ${primaryTravel.toFixed(2)}pt`);
    for (const event of report.events.filter(event => event.type.endsWith('handoff'))) {
        assert.ok(event.delta <= 0.12, `handoff moved ${event.delta}pt`);
        if (event.type === 'merge-handoff') assert.ok(event.renderedDelta <= 0.12, 'location clearance broke the rendered merge handoff');
    }
    for (const event of report.events.filter(event => event.type === 'split-spawn')) {
        assert.ok(event.delta <= 0.12, `split duplicate jumped away from its stretched count by ${event.delta}pt`);
        assert.ok(event.renderedDelta <= 0.12, 'location clearance broke the rendered split duplicate');
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
    assert.ok(report.baseline.find(view => view.id === 'lab-0').tintScore > 0,
        'the cheapest confirmed price should remain green');
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
    for (const frame of report.samples) {
        for (const view of frame.views.filter(view => view.priceMix > 0.5)) {
            assert.equal(view.tintScore, report.marketScores[view.id], 'culling/re-entry changed a station tint');
        }
    }
    assert.equal(report.final.length, 6);
    const maxError = Math.max(...report.anchorSamples.map(sample => sample.originError));
    t.diagnostic(`${rebases} native carrier rebases; maximum surface offset ${maxError.toFixed(3)}pt`);
});

test('stacked stations split without an intermediate connected count stretch', { timeout: 90000 }, async t => {
    const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
    const token = `vertical-${Date.now()}`;
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
    assert.ok(report, 'vertical probe did not export');
    assert.equal(report.status, 'completed');
    assert.equal(report.baseline.length, 2);
    assert.equal(report.final.length, 2);
    assert.ok(Math.abs(report.baseline[0].x - report.baseline[1].x) < 0.1, 'fixture must be vertically stacked');
    const connected = report.samples.flatMap(frame => frame.views.filter(view => view.role === 'badge'));
    assert.ok(connected.length > 20, 'missing live vertical merge coverage');
    for (const badge of connected) {
        assert.equal(badge.attachmentOffset, 56, 'vertical separation stretched the connected count');
        assert.equal(badge.count, 1);
        assert.equal(badge.priceMix, 0);
    }
    let isolatedFrames = 0;
    for (const frame of report.samples) {
        const prices = frame.views.filter(view => view.role === 'price');
        if (prices.length !== 2) continue;
        const [a, b] = prices;
        const verticalGap = Math.abs(a.y - b.y) - 32;
        if (Math.abs(a.x - b.x) < 1 && verticalGap > 2 && verticalGap <= 36) {
            assert.ok(Number.isInteger(a.glassGroup) && Number.isInteger(b.glassGroup));
            assert.notEqual(a.glassGroup, b.glassGroup, 'stacked prices formed an early native glass bridge');
            assert.equal(frame.glassGroupCount, 2);
            isolatedFrames++;
        }
    }
    assert.ok(isolatedFrames > 20, 'missing live close vertical price coverage');
    t.diagnostic(`${isolatedFrames} close vertical frames in separate native effects`);
    const splits = report.events.filter(event => event.type === 'split-spawn');
    assert.ok(splits.length >= 2, 'missing repeated vertical splits');
    for (const split of splits) assert.ok(split.delta <= 0.12, 'vertical split changed the count position at handoff');
    t.diagnostic(`${connected.length} connected vertical frames without count stretch; ${splits.length} splits`);
});

test('initial camera fit shows every station and count within safe margins on its first rendered frame', { timeout: 30000 }, async t => {
    const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
    const token = `fit-${Date.now()}`;
    const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, 'com.anthonyh.fuelup', 'data'], { encoding: 'utf8' }).trim();
    const file = path.join(container, 'Documents/cluster-lab-probe.json');
    execFileSync('xcrun', ['simctl', 'openurl', device, `fuelup:///cluster-lab?clusterLabProbe=${token}`]);
    let report;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        try {
            const value = JSON.parse(readFileSync(file, 'utf8'));
            if (value.token === token) { report = value; break; }
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(report, 'camera fit probe did not export');
    assert.equal(report.status, 'completed');
    assert.ok(report.samples.length >= 30);
    const bounds = report.fitBounds;
    let tightestMargin = Infinity;
    for (const frame of report.samples) {
        assert.equal(frame.stationCount, 6, 'fit dropped a station');
        assert.equal(frame.animating, false, 'first layout animated in from the old camera');
        const represented = frame.views.reduce((count, view) => count + (view.role === 'badge' ? view.count : 1), 0);
        assert.equal(represented, 6, 'fit hid a station without a count');
        for (const view of frame.views) {
            const x = view.x - 360, y = view.y - 360;
            const left = x - view.width / 2 - bounds.x;
            const right = bounds.x + bounds.width - x - view.width / 2;
            const top = y - 16 - bounds.y;
            const bottom = bounds.y + bounds.height - y - 16;
            assert.ok(Math.min(left, right, top, bottom) >= -1, `fit clipped ${view.id}: ${[left, right, top, bottom]}`);
            tightestMargin = Math.min(tightestMargin, left, right);
        }
    }
    assert.equal(report.events.length, 0, 'initial fit triggered split/merge flights');
    assert.ok(tightestMargin <= 1, 'native camera zoomed out beyond the solved fit');
    t.diagnostic(`${report.samples.length} fitted frames; minimum side clearance beyond 17pt inset: ${tightestMargin.toFixed(2)}pt`);
});

test('native user location stays visible with a nearby price and count gently displaced', { timeout: 30000 }, async t => {
    const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
    const token = `location-${Date.now()}`;
    const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, 'com.anthonyh.fuelup', 'data'], { encoding: 'utf8' }).trim();
    const file = path.join(container, 'Documents/cluster-lab-probe.json');
    execFileSync('xcrun', ['simctl', 'openurl', device, `fuelup:///cluster-lab?clusterLabProbe=${token}`]);
    let report;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        try {
            const value = JSON.parse(readFileSync(file, 'utf8'));
            if (value.token === token) { report = value; break; }
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(report, 'location clearance probe did not export');
    assert.equal(report.status, 'completed');
    assert.equal(report.nativeUserLocationVisible, true, 'MapKit did not present the real user-location annotation');
    assert.equal(report.userLocationZPriority, 1000, 'location dot must stay above the glass carrier');
    assert.ok(report.samples.length >= 30);
    for (const frame of report.samples) {
        assert.ok(Number.isFinite(frame.userLocation.x) && Number.isFinite(frame.userLocation.y), 'missing live location fix');
        const price = frame.views.find(view => view.id === 'lab-0');
        const badge = frame.views.find(view => view.id === 'badge:lab-0');
        assert.ok(price && badge, 'missing price/count pair at the user location');
        assert.ok(Math.abs(price.clearanceY) >= 30 && Math.abs(price.clearanceY) <= 32);
        assert.equal(price.clearanceY, badge.clearanceY, 'connected glass was pulled apart by location avoidance');
        for (const view of [price, badge]) {
            const dx = Math.max(0, Math.abs(view.x - frame.userLocation.x) - (view.width - 32) / 2);
            const gap = Math.hypot(dx, view.y - frame.userLocation.y) - 16;
            assert.ok(gap >= 14.9, `pill covers the native location dot: ${gap}`);
        }
        for (const view of frame.views.filter(view => view.id === 'lab-2' || view.id === 'lab-3')) {
            assert.equal(view.clearanceY, 0, 'unrelated station was moved');
        }
    }
    t.diagnostic(`${report.samples.length} frames with a native blue dot and bounded shared price/count clearance`);
});

test('stacked price/count rows do not reconnect diagonally through their badges', { timeout: 90000 }, async t => {
    const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
    const token = `rows-${Date.now()}`;
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
    assert.ok(report, 'stacked rows probe did not export');
    assert.equal(report.status, 'completed');
    let isolatedFrames = 0;
    for (const frame of report.samples) {
        const prices = frame.views.filter(view => view.role === 'price' && view.primary);
        const badges = frame.views.filter(view => view.role === 'badge');
        if (prices.length !== 2 || badges.length !== 2) continue;
        const [a, b] = prices;
        const gap = Math.abs(a.y - b.y) - 32;
        if (Math.abs(a.x - b.x) >= 1 || gap <= 2 || gap > 36) continue;
        assert.notEqual(a.glassGroup, b.glassGroup, 'price/count rows formed an early vertical native bridge');
        for (const price of prices) {
            const badge = badges.find(view => view.id === `badge:${price.id}`);
            assert.ok(badge, 'missing horizontal count');
            assert.equal(price.glassGroup, badge.glassGroup, 'horizontal price/count glass separated');
        }
        isolatedFrames++;
    }
    assert.ok(isolatedFrames > 20, 'missing close stacked price/count row coverage');
    t.diagnostic(`${isolatedFrames} close stacked row frames with horizontal glass intact and vertical effects isolated`);
});

for (const orientation of ['north', 'rotated']) {
    test(`native focus isolates a chip with ${orientation} camera heading`, { timeout: 30000 }, async t => {
        const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
        const token = `focus-${orientation}-${Date.now()}`;
        const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, 'com.anthonyh.fuelup', 'data'], { encoding: 'utf8' }).trim();
        const file = path.join(container, 'Documents/cluster-lab-probe.json');
        execFileSync('xcrun', ['simctl', 'openurl', device, `fuelup:///cluster-lab?clusterLabProbe=${token}`]);
        let report;
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            try {
                const value = JSON.parse(readFileSync(file, 'utf8'));
                if (value.token === token) { report = value; break; }
            } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        assert.ok(report, 'focus probe did not export');
        assert.equal(report.status, 'completed');
        assert.equal(report.focus.requested, true);
        for (const frame of report.samples) {
            for (const view of frame.views.filter(view => view.priceMix > 0.5)) {
                assert.equal(view.tintScore, report.marketScores[view.id], 'zoom/culling changed a visible price tint');
            }
        }
        assert.ok(report.focus.requestMilliseconds < 50, 'focus calculation and camera request blocked the main thread');
        t.diagnostic(`Focus calculation and camera request: ${report.focus.requestMilliseconds.toFixed(2)}ms`);
        assert.ok(report.baseline.some(v => v.role === 'badge'), 'focus must start connected');
        assert.ok(report.focus.afterDistance < report.focus.beforeDistance * 0.8, 'native camera did not zoom in');
        assert.ok(Math.abs(report.focus.afterHeading - report.focus.beforeHeading) < 0.1, 'focus rotated the map');
        assert.ok(report.focus.centerError < 1, 'native camera did not center the selected station');
        const camera = report.focusCameraSamples;
        assert.ok(camera?.length > 30, 'missing live camera animation samples');
        const start = camera.findLast(frame => frame.time <= 1).projectedDistance;
        const end = camera.at(-1).projectedDistance;
        const progress = camera.map(frame => ({ time: frame.time,
            zoom: Math.log(frame.projectedDistance / start) / Math.log(end / start) }));
        const intermediate = progress.filter(frame => frame.zoom > 0.02 && frame.zoom < 0.98);
        assert.ok(intermediate.length >= 8, `camera jumped instead of animating: ${intermediate.length} intermediate frames`);
        const maxStep = Math.max(...progress.slice(1).map((frame, index) => Math.abs(frame.zoom - progress[index].zoom)));
        assert.ok(maxStep < 0.35, `camera skipped ${(maxStep * 100).toFixed(1)}% of its zoom in one frame`);
        t.diagnostic(`${intermediate.length} intermediate map frames; largest zoom step ${(maxStep * 100).toFixed(1)}%`);
        const settled = report.samples.slice(-30);
        assert.ok(settled.length === 30);
        for (const frame of settled) {
            const target = frame.views.find(v => v.id === 'lab-0');
            assert.ok(target && target.primary && target.role === 'price', 'target stayed inside another cluster');
            assert.ok(Math.abs(target.width - 84 * 1.18) < 0.01, 'focused glass did not enlarge');
            assert.ok(Math.abs(target.height - 32 * 1.18) < 0.01, 'focused glass lost its aspect ratio');
            assert.ok(!frame.views.some(v => v.id === 'badge:lab-0'), 'target retained a connected count');
            for (const other of frame.views.filter(v => v.id !== 'lab-0' && v.glassGroup === target.glassGroup)) {
                const dx = Math.max(0, Math.abs(target.x - other.x) - (target.width + other.width - 64) / 2);
                assert.ok(Math.hypot(dx, target.y - other.y) - 32 > 36, 'target retained a native glass bridge');
            }
            assert.ok(target.contained, 'focus clipped the selected chip');
        }
        assert.ok(report.events.some(e => e.type === 'split-spawn'), 'focus bypassed the existing split animation');
        t.diagnostic(`Native zoom ${(report.focus.beforeDistance / report.focus.afterDistance).toFixed(2)}x; center error ${report.focus.centerError.toFixed(3)}pt`);
    });
}


test('focused pill size retargets continuously without moving its map anchor or adding views', { timeout: 30000 }, async t => {
    const device = process.env.FUELUP_SIMULATOR_UDID || 'booted';
    const token = `emphasis-${Date.now()}`;
    const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, 'com.anthonyh.fuelup', 'data'], { encoding: 'utf8' }).trim();
    const file = path.join(container, 'Documents/cluster-lab-probe.json');
    execFileSync('xcrun', ['simctl', 'openurl', device, `fuelup:///cluster-lab?clusterLabProbe=${token}`]);
    let report;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        try {
            const value = JSON.parse(readFileSync(file, 'utf8'));
            if (value.token === token) { report = value; break; }
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(report, 'emphasis probe did not export');
    assert.equal(report.status, 'completed');
    assert.ok(report.samples.length > 100);
    const start = report.samples[0].time;
    const frames = report.samples.filter(frame => frame.time - start > 0.8);
    const widths = new Map();
    let maximumStep = 0, intermediate = 0;
    for (const frame of frames) {
        assert.ok(frame.viewCount <= 6, 'selection allocated duplicate pills');
        for (const view of frame.views.filter(view => view.primary)) {
            assert.ok(view.contained, 'selection clipped native glass');
            assert.ok(Math.hypot(view.x - view.homeX, view.y - view.homeY - view.clearanceY) < 0.1, 'size change moved the map anchor');
            assert.ok(Math.abs(view.width / view.height - 84 / 32) < 0.001, 'glass did not scale uniformly');
            if (view.id !== 'lab-0' && view.id !== 'lab-1') assert.equal(view.width, 84, 'unselected pill changed size');
            if (widths.has(view.id)) maximumStep = Math.max(maximumStep, Math.abs(view.width - widths.get(view.id)));
            widths.set(view.id, view.width);
            if (view.width > 85 && view.width < 98) intermediate++;
        }
    }
    assert.ok(intermediate >= 12, 'size jumped rather than animating through interrupted selections');
    assert.ok(maximumStep < 4, `size discontinuity: ${maximumStep}pt`);
    const final = report.samples.at(-1);
    assert.equal(final.selectedId, 'lab-1');
    for (const view of final.views.filter(view => view.primary)) {
        assert.ok(Math.abs(view.width - (view.id === 'lab-1' ? 84 * 1.18 : 84)) < 0.01);
    }
    assert.equal(final.animating, false, 'selection failed to settle');
    t.diagnostic(`${intermediate} intermediate sizes; maximum width step ${maximumStep.toFixed(2)}pt`);
});
