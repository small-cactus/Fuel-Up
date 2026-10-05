// Fault injection lives entirely below the real timeout/health boundary.
// Only the developer switch reads this state; consumers see an ordinary request.
function createAPITransport(transport = (...args) => globalThis.fetch(...args)) {
    let enabled = false;
    const listeners = new Set();
    const waiting = new Set();
    const cancelled = () => Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
    const waitForDelivery = signal => new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(cancelled()); return; }
        if (!enabled) { resolve(); return; }
        const cleanup = () => { waiting.delete(release); signal?.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(cancelled()); };
        const release = () => { cleanup(); resolve(); };
        waiting.add(release);
        signal?.addEventListener('abort', abort, { once: true });
    });
    return {
        getSnapshot: () => enabled,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        setEnabled(value) {
            if (enabled === value) return;
            enabled = value;
            if (!enabled) [...waiting].forEach(release => release());
            listeners.forEach(listener => listener());
        },
        async fetch(input, init) {
            const signal = init?.signal || input?.signal;
            await waitForDelivery(signal);
            try {
                const response = await transport(input, init);
                await waitForDelivery(signal);
                return response;
            } catch (error) {
                await waitForDelivery(signal);
                throw error;
            }
        },
    };
}
const apiTransport = createAPITransport();
module.exports = { createAPITransport, apiTransport };
