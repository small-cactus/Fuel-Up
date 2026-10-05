import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnboardingHandoff } from '../src/lib/onboardingHandoff.js';

test('Save keeps onboarding mounted until Home renders and the full reveal completes', async () => {
    const state = createOnboardingHandoff();
    const phases = [];
    state.subscribe(() => phases.push(state.getSnapshot()));
    let ready = false;
    const waiting = state.prepare().then(() => { ready = true; });
    state.reveal();
    await Promise.resolve();
    assert.equal(ready, false);
    assert.equal(state.getSnapshot(), 'preparing');
    assert.throws(() => state.prepare(), /already/);
    state.mapReady();
    await waiting;
    assert.equal(state.getSnapshot(), 'preparing', 'preference persistence still must complete');
    state.reveal();
    assert.equal(state.getSnapshot(), 'revealing');
    state.mapReady();
    assert.equal(state.getSnapshot(), 'revealing');
    state.finish();
    assert.deepEqual(phases, ['preparing', 'revealing', 'idle']);
});

for (const failure of ['timeout', 'network']) {
    test(`${failure} never reveals an empty Home and permits retry`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const state = createOnboardingHandoff({ timeoutMs: 1000 });
        const rejected = assert.rejects(state.prepare(), failure === 'timeout' ? /longer/ : /offline/);
        if (failure === 'timeout') t.mock.timers.tick(1000);
        else state.fail(new Error('offline'));
        await rejected;
        state.mapReady(); state.reveal();
        assert.equal(state.getSnapshot(), 'preparing');
        state.finish();
        const retry = state.prepare();
        state.mapReady(); await retry; state.reveal(); state.finish();
        assert.equal(state.getSnapshot(), 'idle');
    });
}
