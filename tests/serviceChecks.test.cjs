const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkStatus, SERVICES } = require('../src/lib/networkStatus');
const { createServiceChecks } = require('../src/lib/serviceChecks');
const { createAPITransport } = require('../src/lib/apiTransport');
function setup(transport, timeoutMs = 100) {
    const store = createNetworkStatus({ timeoutMs });
    store.configureHealthChecks(createServiceChecks({ url: 'https://example', key: 'test', monitor: store, transport }));
    return store;
}
test('outage checks every displayed service without visiting its screen or replaying writes', async () => {
    const requests = [];
    const store = setup(async (url, init) => { requests.push({ url, ...init }); return { status: 200 }; });
    await store.checkServices();
    assert.equal(requests.length, SERVICES.length);
    assert(store.getSnapshot().services.every(s => s.status === 'responding' && !s.pending));
    assert.deepEqual(requests.filter(r => r.method === 'POST').map(r => JSON.parse(r.body)),
        [{ scope: 'national', fuelType: 'regular' }, { p_state: 'FL' }]);
    assert(requests.filter(r => /station_prices|push_tokens/.test(r.url)).every(r => r.method === 'HEAD'));
    assert(requests.some(r => r.url.endsWith('/driving-research/health')));
    await store.checkServices({ onlyUnhealthy: true });
    assert.equal(requests.length, SERVICES.length, 'healthy services are not polled every five seconds');
});
test('every service really times out, retries without overlap, and recovers through the fault-gated transport', async () => {
    let calls = 0;
    const transport = createAPITransport(async () => { calls++; return { status: 200 }; });
    const store = setup(transport.fetch, 10);
    transport.setEnabled(true);
    const first = store.checkServices();
    assert(store.getSnapshot().services.every(s => s.pending));
    await store.checkServices();
    await first;
    assert.equal(calls, 0);
    assert(store.getSnapshot().services.every(s => s.status === 'unresponsive' && !s.pending));
    const retry = store.checkServices({ onlyUnhealthy: true });
    assert(store.getSnapshot().services.every(s => s.pending));
    transport.setEnabled(false);
    await retry;
    assert.equal(calls, SERVICES.length);
    assert(store.getSnapshot().services.every(s => s.status === 'responding' && !s.pending));
});
test('health probes require success, not merely an auth or method error from a gateway', async () => {
    for (const status of [401, 403, 405, 429, 503]) {
        const store = setup(async () => ({ status }));
        await store.checkServices();
        assert(store.getSnapshot().services.every(s => s.status === 'unresponsive'));
    }
});
test('offline checks do not start requests; reconnect checks all services', async () => {
    let calls = 0;
    const store = setup(async () => { calls++; return { status: 200 }; });
    store.setConnected(false); await store.checkServices(); assert.equal(calls, 0);
    store.setConnected(true); await store.checkServices(); assert.equal(calls, SERVICES.length);
});
