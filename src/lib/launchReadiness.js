// One launch per process. Re-entering onboarding or changing tabs never shows
// the splash again. A bounded fallback also covers denied location/offline maps.
export function createLaunchReadiness() {
    let ready = false;
    const listeners = new Set();
    return {
        getSnapshot: () => ready,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        finish() {
            if (ready) return;
            ready = true;
            listeners.forEach(listener => listener());
        },
    };
}
export const launchReadiness = createLaunchReadiness();
export const finishLaunch = () => launchReadiness.finish();
