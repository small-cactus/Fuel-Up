const { apiRequestTimeout } = require('./apiTimeouts');
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
function createNetworkStatus({ timeoutMs } = {}) {
    const listeners = new Set();
    const latestRequest = new Map();
    const readRetries = new Map();
    const retrying = new Set();
    let healthChecks = {};
    let requestSequence = 0;
    let snapshot = { connected: null, recoveryGeneration: 0,
        services: SERVICES.map(service => ({ ...service, status: 'unknown' })) };
    const publish = changes => { snapshot = { ...snapshot, ...changes }; listeners.forEach(fn => fn()); };
    const report = (id, status, pending = null) => {
        const recovered = status === 'responding' && snapshot.services.some(service => service.id === id && service.status === 'unresponsive');
        publish({ recoveryGeneration: snapshot.recoveryGeneration + (recovered ? 1 : 0), services: snapshot.services.map(service => service.id === id ? { ...service, status: ['pending', 'cancelled'].includes(status) ? service.status : status, pending } : service) });
    };
    const api = {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        report,
        setConnected: connected => { if (connected !== snapshot.connected) publish({ connected }); },
        configureHealthChecks(checks) { healthChecks = checks; },
        async checkServices({ onlyUnhealthy = false } = {}) {
            if (snapshot.connected === false) return;
            await Promise.all(snapshot.services.filter(service => !service.pending &&
                (!onlyUnhealthy || service.status !== 'responding')).map(async ({ id }) => {
                const check = healthChecks[id];
                if (!check || retrying.has(id)) return;
                retrying.add(id);
                try { await check(); } catch { /* Each monitored check publishes its own result. */ }
                finally { retrying.delete(id); }
            }));
        },
        async retryFailedReads() {
            if (snapshot.connected === false) return;
            await Promise.all(snapshot.services.filter(service => service.status === 'unresponsive' && !service.pending).map(async ({ id }) => {
                if (!readRetries.has(id) || retrying.has(id)) return;
                retrying.add(id);
                try { await readRetries.get(id)(); } catch { /* The transport publishes the result. */ }
                finally { retrying.delete(id); }
            }));
        },
        async fetch(input, init, transport = globalThis.fetch, { serviceId, healthCheck = false } = {}) {
            const url = String(input?.url || input);
            const id = serviceId || (url.includes('/functions/v1/gas-prices') ? 'prices' :
                url.includes('fuel_memberships_for_state') ? 'memberships' :
                url.includes('station_prices') ? 'history' : url.includes('push_tokens') ? 'notifications' : url.includes('/functions/v1/driving-research') ? 'research' : 'account');
            const method = String(init?.method || input?.method || 'GET').toUpperCase();
            // Recheck only known reads, never replay a notification/auth write.
            if (!healthCheck && typeof input === 'string' && (['GET', 'HEAD'].includes(method) ||
                (method === 'POST' && ['prices', 'memberships'].includes(id)))) {
                readRetries.set(id, () => api.fetch(input, { ...init, signal: undefined }, transport));
            }
            const signal = init?.signal || input?.signal;
            if (signal?.aborted) throw Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
            const requestId = ++requestSequence;
            latestRequest.set(id, requestId);
            const reportRequest = status => { if (latestRequest.get(id) === requestId) report(id, status); };
            const controller = new AbortController();
            const startedAt = Date.now();
            const duration = timeoutMs ?? apiRequestTimeout(input, init);
            const previousStatus = snapshot.services.find(service => service.id === id)?.status || 'unknown';
            report(id, 'pending', { startedAt, deadlineAt: startedAt + duration });
            let timedOut = false;
            let rejectAbort;
            const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
            const abort = () => {
                rejectAbort(Object.assign(new Error(timedOut ? 'API request timed out' : 'Request cancelled'),
                    { name: timedOut ? 'TimeoutError' : 'AbortError' }));
                controller.abort();
            };
            signal?.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(() => { timedOut = true; abort(); }, duration);
            try {
                const response = await Promise.race([transport(input, { ...init, signal: controller.signal }), abortPromise]);
                const failed = healthCheck ? response.status < 200 || response.status >= 300 : response.status >= 500 || response.status === 429;
                reportRequest(failed ? 'unresponsive' : 'responding');
                return response;
            } catch (error) {
                reportRequest(timedOut || error?.name !== 'AbortError' ? 'unresponsive' : previousStatus);
                throw error;
            } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }

        },
    };
    return api;
}
const networkStatus = createNetworkStatus();
module.exports = { SERVICES, createNetworkStatus, networkStatus };
