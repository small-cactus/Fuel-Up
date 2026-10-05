const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkStatus } = require('../src/lib/networkStatus');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

test('faults hold new requests without dispatch and release once disabled', async () => {
    const store = createNetworkStatus(); let calls = 0, finished = false;
    store.setFaultsEnabled(true);
    const result = store.fetch('https://example/functions/v1/gas-prices', {}, async () => { calls++; return { status: 200 }; }).then(() => finished = true);
    await tick(); assert.equal(calls, 0); assert.equal(finished, false);
    assert.ok(store.getSnapshot().services.every(s => s.status === 'unresponsive'));
    store.setFaultsEnabled(false); await result;
    assert.equal(calls, 1); assert.equal(finished, true);
    assert.equal(store.getSnapshot().services.find(s => s.id === 'prices').status, 'responding');
    assert.equal(store.getSnapshot().services.find(s => s.id === 'research').status, 'unknown');
});
test('faults hold already dispatched responses, and cancellation cannot dispatch queued writes', async () => {
    const store = createNetworkStatus(); const pending = deferred(); let finished = false;
    const result = store.fetch('https://example/rest/v1/station_prices', {}, () => pending.promise).then(() => finished = true);
    await tick(); store.setFaultsEnabled(true); pending.resolve({ status: 200 }); await tick();
    assert.equal(finished, false);
    const controller = new AbortController(); let writes = 0;
    const write = store.fetch('https://example/rest/v1/push_tokens', { signal: controller.signal }, () => { writes++; });
    controller.abort(); await tick(); assert.equal(writes, 0);
    const rejected = assert.rejects(write, { name: 'AbortError' });
    store.setFaultsEnabled(false); await result; await rejected; assert.equal(writes, 0);
});
test('timeout marks only the affected service, aborts transport, and success recovers it', async () => {
    const store = createNetworkStatus({ timeoutMs: 5 });
    await assert.rejects(store.fetch('https://example/rest/v1/rpc/fuel_memberships_for_state', {}, (_, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    })));
    assert.equal(store.getSnapshot().services.find(s => s.id === 'memberships').status, 'unresponsive');
    assert.equal(store.getSnapshot().services.find(s => s.id === 'prices').status, 'unknown');
    await store.fetch('https://example/rest/v1/rpc/fuel_memberships_for_state', {}, async () => ({ status: 200 }));
    assert.equal(store.getSnapshot().services.find(s => s.id === 'memberships').status, 'responding');
});
test('older failures cannot overwrite newer successful requests; offline is independently known', async () => {
    const store = createNetworkStatus(); const pending = deferred();
    const old = store.fetch('https://example/functions/v1/gas-prices', {}, () => pending.promise);
    await tick(); await store.fetch('https://example/functions/v1/gas-prices', {}, async () => ({ status: 200 }));
    pending.resolve({ status: 503 }); await old;
    assert.equal(store.getSnapshot().services[0].status, 'responding');
    store.setConnected(false); assert.equal(store.getSnapshot().connected, false);
    store.setConnected(true); assert.equal(store.getSnapshot().connected, true);
});
test('HTTP server faults differ from a responding service with a client error', async () => {
    const store = createNetworkStatus();
    await store.fetch('https://example/auth/v1', {}, async () => ({ status: 503 }));
    assert.equal(store.getSnapshot().services.find(s => s.id === 'account').status, 'unresponsive');
    await store.fetch('https://example/auth/v1', {}, async () => ({ status: 401 }));
    assert.equal(store.getSnapshot().services.find(s => s.id === 'account').status, 'responding');
});
test('outage recovery retries failed reads but never replays writes', async () => {
    const store = createNetworkStatus(); let reads = 0, writes = 0;
    await store.fetch('https://example/rest/v1/station_prices', {}, async () => ({ status: ++reads === 1 ? 503 : 200 }));
    await store.fetch('https://example/rest/v1/push_tokens', { method: 'POST' }, async () => { writes++; return { status: 503 }; });
    await store.retryFailedReads();
    assert.equal(reads, 2); assert.equal(writes, 1);
    assert.equal(store.getSnapshot().recoveryGeneration, 1, 'successful recovery prompts Home to refresh its prices');
    assert.equal(store.getSnapshot().services.find(s => s.id === 'history').status, 'responding');
    store.setFaultsEnabled(true); await store.retryFailedReads(); assert.equal(reads, 2);
});
test('responses from before a fault cycle cannot reintroduce a stale outage', async () => {
    const store = createNetworkStatus(); const pending = deferred();
    const request = store.fetch('https://example/rest/v1/station_prices', {}, () => pending.promise);
    await tick(); store.setFaultsEnabled(true); store.setFaultsEnabled(false);
    pending.resolve({ status: 503 }); await request;
    assert.equal(store.getSnapshot().services.find(s => s.id === 'history').status, 'unknown');
});
