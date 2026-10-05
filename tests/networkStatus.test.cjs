const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkStatus } = require('../src/lib/networkStatus');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

const { createAPITransport } = require('../src/lib/apiTransport');
const { apiRequestTimeout } = require('../src/lib/apiTimeouts');
const pricesURL = 'https://example/functions/v1/gas-prices';
const priceStatus = store => store.getSnapshot().services.find(s => s.id === 'prices');

test('only actual requests affect health; toggling faults neither fails nor recovers services', async () => {
    const store = createNetworkStatus({ timeoutMs: 10 }); let calls = 0;
    const transport = createAPITransport(async () => { calls++; return { status: 200 }; });
    const initial = store.getSnapshot();
    transport.setEnabled(true);
    assert.equal(store.getSnapshot(), initial);
    const result = store.fetch(pricesURL, {}, transport.fetch);
    assert.equal(priceStatus(store).status, 'unknown');
    assert.equal(priceStatus(store).pending.deadlineAt - priceStatus(store).pending.startedAt, 10);
    await assert.rejects(result, { name: 'TimeoutError' });
    assert.equal(calls, 0);
    assert.equal(priceStatus(store).status, 'unresponsive');
    assert.equal(priceStatus(store).pending, null);
    assert(store.getSnapshot().services.filter(s => s.id !== 'prices').every(s => s.status === 'unknown'));
    const failed = store.getSnapshot();
    transport.setEnabled(false);
    assert.equal(store.getSnapshot(), failed);
    await store.fetch(pricesURL, {}, transport.fetch);
    assert.equal(priceStatus(store).status, 'responding');
    assert.equal(store.getSnapshot().recoveryGeneration, 1);
    assert.equal('faultsEnabled' in store.getSnapshot(), false);
});
test('injected and real non-returning transports use the same Trends deadline for the map', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    for (const injected of [false, true]) {
        const store = createNetworkStatus();
        const transport = createAPITransport(async () => ({ status: 200 }));
        transport.setEnabled(true);
        const result = store.fetch(pricesURL, {}, injected ? transport.fetch : () => new Promise(() => {}));
        const rejected = assert.rejects(result, { name: 'TimeoutError' });
        assert.equal(priceStatus(store).pending.deadlineAt - Date.now(), 20000);
        t.mock.timers.tick(19999); await tick();
        assert.equal(priceStatus(store).status, 'unknown');
        t.mock.timers.tick(1); await rejected;
        assert.equal(priceStatus(store).status, 'unresponsive');
    }
    assert.equal(apiRequestTimeout(pricesURL, { body: JSON.stringify({ scope: 'national' }) }), 20000);
    assert.equal(apiRequestTimeout('https://example/rest/v1/rpc/fuel_memberships_for_state'), 15000);
});
test('faults hold dispatched responses; cancellation and timeout cannot dispatch queued writes', async () => {
    const store = createNetworkStatus({ timeoutMs: 100 }); const pending = deferred(); let finished = false;
    const transport = createAPITransport(() => pending.promise);
    const result = store.fetch(pricesURL, {}, transport.fetch).then(() => finished = true);
    await tick(); transport.setEnabled(true); pending.resolve({ status: 200 }); await tick();
    assert.equal(finished, false);
    transport.setEnabled(false); await result;
    for (const cancel of [true, false]) {
        const writeStore = createNetworkStatus({ timeoutMs: 5 });
        let writes = 0; const writeTransport = createAPITransport(async () => { writes++; return { status: 200 }; });
        writeTransport.setEnabled(true);
        const controller = new AbortController();
        const write = writeStore.fetch('https://example/rest/v1/push_tokens', { method: 'POST', signal: controller.signal }, writeTransport.fetch);
        const rejected = assert.rejects(write, { name: cancel ? 'AbortError' : 'TimeoutError' });
        if (cancel) controller.abort();
        await rejected;
        writeTransport.setEnabled(false); await tick();
        assert.equal(writes, 0);
        assert.equal(writeStore.getSnapshot().services.find(s => s.id === 'notifications').status, cancel ? 'unknown' : 'unresponsive');
    }
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
    store.setConnected(false); await store.retryFailedReads(); assert.equal(reads, 2);
});
test('native cancellation clears pending without manufacturing a service failure', () => {
    const store = createNetworkStatus();
    store.report('research', 'responding');
    store.report('research', 'pending', { startedAt: 1, deadlineAt: 20001 });
    store.report('research', 'cancelled');
    const research = store.getSnapshot().services.find(s => s.id === 'research');
    assert.equal(research.status, 'responding'); assert.equal(research.pending, null);
});
test('reconnection retries are real requests and never overlap an active request', async () => {
    const store = createNetworkStatus();
    const response = deferred(); let calls = 0;
    const transport = async () => { calls++; return calls === 1 ? { status: 503 } : response.promise; };
    await store.fetch(pricesURL, {}, transport);
    const retry = store.retryFailedReads();
    assert.equal(calls, 2);
    assert.ok(priceStatus(store).pending);
    assert.equal(priceStatus(store).status, 'unresponsive');
    await store.retryFailedReads();
    assert.equal(calls, 2, 'polling does not duplicate the pending reconnect');
    response.resolve({ status: 200 }); await retry;
    assert.equal(priceStatus(store).pending, null);
    assert.equal(priceStatus(store).status, 'responding');
});
