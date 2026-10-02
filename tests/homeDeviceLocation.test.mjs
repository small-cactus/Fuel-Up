import test from 'node:test';
import assert from 'node:assert/strict';
import { startHomeDeviceLocation } from '../src/lib/homeDeviceLocation.js';
const tick = () => new Promise(setImmediate);
const old = { latitude: 27.9659, longitude: -82.8001 };
const tampa = { latitude: 28.01, longitude: -82.577 };
function setup({ granted = true, delayedWatch = false } = {}) {
    let origin = old, handler, listener, resolveCurrent, resolveWatch;
    const fixes = [], errors = [];
    let removed = 0, currentCalls = 0, watchCalls = 0;
    const AppState = { currentState: 'active', addEventListener: (_, fn) => { listener = fn; return { remove() { listener = null; } }; } };
    const Location = {
        Accuracy: { Balanced: 3 },
        getForegroundPermissionsAsync: async () => ({ status: granted ? 'granted' : 'denied' }),
        getCurrentPositionAsync: () => { currentCalls++; return new Promise(resolve => { resolveCurrent = resolve; }); },
        watchPositionAsync: async (_, fn) => { watchCalls++; handler = fn; const subscription = { remove() { removed++; } }; return delayedWatch ? new Promise(resolve => { resolveWatch = () => resolve(subscription); }) : subscription; },
    };
    const stop = startHomeDeviceLocation({ Location, AppState, getOrigin: () => origin,
        onLocation: fix => { origin = fix.coords; fixes.push(fix); }, onError: e => errors.push(e), now: () => 1_000_000 });
    return { fixes, errors, stop, fix: (coords, timestamp = 1_000_000) => ({ coords, timestamp }),
        emit: fix => handler(fix), current: fix => resolveCurrent(fix), finishWatch: () => resolveWatch(),
        state: value => { AppState.currentState = value; listener?.(value); },
        counts: () => ({ removed, currentCalls, watchCalls }), };
}
test('replaces an existing saved origin and follows foreground movement, ignoring GPS drift', async () => {
    const h = setup(); await tick();
    h.current(h.fix(tampa)); await tick();
    assert.deepEqual(h.fixes[0].coords, tampa);
    h.emit(h.fix({ latitude: 28.01001, longitude: -82.577 }, 1_000_001));
    assert.equal(h.fixes.length, 1);
    h.emit(h.fix({ latitude: 28.02, longitude: -82.577 }, 1_000_002));
    assert.equal(h.fixes.length, 2); h.stop();
});
test('background stops watching, foreground obtains a fresh fix and restarts movement updates', async () => {
    const h = setup(); await tick(); h.state('background');
    h.emit(h.fix(tampa)); assert.equal(h.fixes.length, 0);
    assert.equal(h.counts().removed, 1);
    h.state('active'); await tick(); h.current(h.fix(tampa)); await tick();
    assert.equal(h.fixes.length, 1); assert.equal(h.counts().currentCalls, 2);
    assert.equal(h.counts().watchCalls, 2); h.stop();
});
test('late one-shot and stale or invalid fixes cannot roll back a newer watched location', async () => {
    const h = setup(); await tick(); h.emit(h.fix(tampa));
    h.current(h.fix(old, 999_000)); await tick();
    h.emit(h.fix(old, 100)); h.emit(h.fix({ latitude: 100, longitude: 0 }));
    assert.equal(h.fixes.length, 1); h.stop();
});
test('unmount removes a subscription whose async setup completed after cleanup', async () => {
    const h = setup({ delayedWatch: true }); await tick(); h.stop(); h.finishWatch(); await tick();
    h.current(h.fix(tampa)); await tick(); h.emit(h.fix(tampa));
    assert.equal(h.fixes.length, 0); assert.equal(h.counts().removed, 1);
});
test('denied permission makes no location requests', async () => {
    const h = setup({ granted: false }); await tick();
    assert.equal(h.counts().currentCalls, 0); assert.equal(h.counts().watchCalls, 0); h.stop();
});
