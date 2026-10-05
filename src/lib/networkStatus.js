// Shared transport boundary. Only app APIs use this; MapKit tiles, Metro and
// bundled assets keep working, including the Dev switch used to recover.
const SERVICES = [
    { id: 'prices', name: 'Fuel prices' },
    { id: 'history', name: 'Price history' },
    { id: 'memberships', name: 'Memberships' },
    { id: 'notifications', name: 'Notifications' },
    { id: 'research', name: 'Driving research' },
    { id: 'account', name: 'Account services' },
];
function createNetworkStatus({ timeoutMs = 12000 } = {}) {
    const listeners = new Set();
    const gates = new Set();
    const latestRequest = new Map();
    const readRetries = new Map();
    const retrying = new Set();
    let requestSequence = 0;
    let snapshot = { faultsEnabled: false, connected: null, generation: 0, recoveryGeneration: 0,
        services: SERVICES.map(service => ({ ...service, status: 'unknown' })) };
    const publish = changes => { snapshot = { ...snapshot, ...changes }; listeners.forEach(fn => fn()); };
    const report = (id, status) => {
        if (snapshot.faultsEnabled) return;
        const recovered = status === 'responding' && snapshot.services.some(service => service.id === id && service.status === 'unresponsive');
        publish({ recoveryGeneration: snapshot.recoveryGeneration + (recovered ? 1 : 0), services: snapshot.services.map(service => service.id === id ? { ...service, status } : service) });
    };
    const waitForRelease = () => snapshot.faultsEnabled ? new Promise(resolve => gates.add(resolve)) : Promise.resolve();
    const api = {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        report,
        setConnected: connected => { if (connected !== snapshot.connected) publish({ connected }); },
        setFaultsEnabled(enabled) {
            if (enabled === snapshot.faultsEnabled) return;
            publish({ faultsEnabled: enabled, generation: snapshot.generation + 1,
                services: SERVICES.map(service => ({ ...service, status: enabled ? 'unresponsive' : 'unknown' })) });
            if (!enabled) { const pending = [...gates]; gates.clear(); pending.forEach(resolve => resolve()); }
        },
        async retryFailedReads() {
            if (snapshot.faultsEnabled || snapshot.connected === false) return;
            await Promise.all(snapshot.services.filter(service => service.status === 'unresponsive').map(async ({ id }) => {
                if (!readRetries.has(id) || retrying.has(id)) return;
                retrying.add(id);
                try { await readRetries.get(id)(); } catch { /* The transport publishes the result. */ }
                finally { retrying.delete(id); }
            }));
        },
        async fetch(input, init, transport = globalThis.fetch) {
            const url = String(input?.url || input);
            const id = url.includes('/functions/v1/gas-prices') ? 'prices' :
                url.includes('fuel_memberships_for_state') ? 'memberships' :
                url.includes('station_prices') ? 'history' : url.includes('push_tokens') ? 'notifications' : 'account';
            const method = String(init?.method || input?.method || 'GET').toUpperCase();
            // Recheck only known reads, never replay a notification/auth write.
            if (typeof input === 'string' && (['GET', 'HEAD'].includes(method) ||
                (method === 'POST' && ['prices', 'memberships'].includes(id)))) {
                readRetries.set(id, () => api.fetch(input, { ...init, signal: undefined }, transport));
            }
            // Hold before dispatch AND before returning an already in-flight response.
            // Turning the switch off releases the gate; normal AbortSignal semantics
            // then apply. Fault mode never silently sends queued writes repeatedly.
            await waitForRelease();
            const signal = init?.signal || input?.signal;
            if (signal?.aborted) throw Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
            const generation = snapshot.generation;
            const requestId = ++requestSequence;
            latestRequest.set(id, requestId);
            const reportRequest = status => { if (snapshot.generation === generation && latestRequest.get(id) === requestId) report(id, status); };
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal?.addEventListener('abort', abort, { once: true });
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; reportRequest('unresponsive'); controller.abort(); }, timeoutMs);
            try {
                const response = await transport(input, { ...init, signal: controller.signal });
                clearTimeout(timer);
                await waitForRelease();
                reportRequest(response.status >= 500 || response.status === 429 ? 'unresponsive' : 'responding');
                return response;
            } catch (error) {
                clearTimeout(timer);
                await waitForRelease();
                if (error?.name !== 'AbortError' || timedOut) reportRequest('unresponsive');
                throw error;
            } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        },
    };
    return api;
}
const networkStatus = createNetworkStatus();
module.exports = { SERVICES, createNetworkStatus, networkStatus };
