// Fault injection lives entirely below the real timeout/health boundary.
// Only the developer switch reads this state; consumers see an ordinary request.
function createAPITransport(transport = (...args) => globalThis.fetch(...args), { initialEnabled = false, onEnabledChange } = {}) {
    let enabled = initialEnabled;
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
            onEnabledChange?.(value);
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
// Synchronous native preferences restore the gate before the first API call.
// The optional bridge is absent in Node tests and on unsupported platforms.
let nativePreferences;
try { nativePreferences = require('../../modules/fuel-up-driving-activity'); } catch { /* No native runtime. */ }
const apiTransport = createAPITransport(undefined, {
    initialEnabled: nativePreferences?.getNetworkFaultsEnabled?.() ?? false,
    onEnabledChange: value => nativePreferences?.setNetworkFaultsEnabled?.(value),
});
module.exports = { createAPITransport, apiTransport };
