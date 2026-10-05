// The final onboarding page covers Home until native map/card layout is ready.
// A deadline is an error with retry, never permission to reveal an empty screen.
export function createOnboardingHandoff({ timeoutMs = 30000 } = {}) {
    let phase = 'idle';
    let pending = null;
    let ready = false;
    const listeners = new Set();
    const publish = next => { phase = next; listeners.forEach(listener => listener()); };
    const settle = error => {
        if (!pending) return;
        const { resolve, reject, timer } = pending;
        pending = null;
        clearTimeout(timer);
        ready = !error;
        error ? reject(error) : resolve();
    };
    return {
        getSnapshot: () => phase,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        prepare() {
            if (phase !== 'idle') throw new Error('Home is already being prepared.');
            ready = false;
            const promise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => settle(new Error('Home is taking longer to load. Check your connection and try Save again.')), timeoutMs);
                pending = { resolve, reject, timer };
            });
            publish('preparing');
            return promise;
        },
        mapReady() { if (phase === 'preparing') settle(); },
        fail(error) { settle(error); },
        reveal() { if (phase === 'preparing' && ready) publish('revealing'); },
        finish() { settle(new Error('Setup was interrupted. Please try again.')); ready = false; publish('idle'); },
    };
}
export const onboardingHandoff = createOnboardingHandoff();
