/**
 * Drive simulation for the Predictive Fueling Live Activity.
 *
 * This is the glue between the dev screen's "Start Drive Simulation"
 * button and the iOS Live Activity. It advances a fake driver along a
 * scripted path toward a station, computing distance / ETA / progress on
 * each tick and pushing updates to the active Live Activity so we can
 * visually verify the layout under changing state.
 *
 * The simulation is intentionally pure JS (no React, no side-effects on
 * the engine or the home map). It only talks to the `notifications`
 * module. That keeps it safe to run from the dev screen without touching
 * real fuel data or the manual location override.
 *
 * Rate limiting: Apple throttles Live Activity updates to a few per
 * second per process. We tick at ~1 Hz by default which stays well under
 * any system budget and still feels smooth to watch.
 */

// Lazy-load notifications.js so this module is safe to import in pure-node
// contexts (unit tests, CLI smoke scripts). notifications.js transitively
// pulls in expo-device / expo-notifications, which only exist inside the
// Metro/Expo runtime — touching them at require-time would crash Node.
function getNotifications() {
    return require('./notifications.js');
}

/**
 * Preset scenarios the dev screen can pick from. Each one is a totally
 * fabricated drive — chosen to exercise different visual states of the
 * Live Activity (short detour, long highway approach, no-savings case,
 * already-arrived). Wawa is the headline example since that's the scenario
 * the design brief called out: "Save $4.20 at Wawa instead? 0.4mi ahead,
 * 1 minute away".
 */
const SIM_SCENARIOS = [
    {
        id: 'wawa-quick-win',
        label: 'Wawa · $4.20 savings',
        stationName: 'Wawa',
        subtitle: 'Route 73',
        pricePerGallon: 2.99,
        baselinePricePerGallon: 3.29,
        fillUpGallons: 14,
        initialDistanceMiles: 0.4,
        initialEtaMinutes: 1,
        durationSeconds: 20,
        startStatus: 'On your route',
    },
    {
        id: 'costco-easy-win',
        label: 'Costco · big savings',
        stationName: 'Costco Gas',
        subtitle: 'Belleview & I-25',
        pricePerGallon: 3.09,
        baselinePricePerGallon: 3.39,
        fillUpGallons: 14,
        initialDistanceMiles: 2.4,
        initialEtaMinutes: 6,
        // Seconds the whole drive should take (wall-clock).
        durationSeconds: 30,
        startStatus: 'On your route',
    },
    {
        id: 'kingsoopers-short',
        label: 'King Soopers · quick hop',
        stationName: 'King Soopers',
        subtitle: 'Colfax & Dahlia',
        pricePerGallon: 3.19,
        baselinePricePerGallon: 3.37,
        fillUpGallons: 12,
        initialDistanceMiles: 0.8,
        initialEtaMinutes: 2,
        durationSeconds: 18,
        startStatus: 'On your route',
    },
    {
        id: 'pilot-highway',
        label: 'Pilot · I-70 exit',
        stationName: 'Pilot',
        subtitle: 'I-70 Exit 289',
        pricePerGallon: 3.49,
        baselinePricePerGallon: 3.68,
        fillUpGallons: 16,
        initialDistanceMiles: 5.2,
        initialEtaMinutes: 5,
        durationSeconds: 24,
        startStatus: 'Exit ahead',
    },
    {
        id: 'shell-no-savings',
        label: 'Shell · baseline pricing',
        stationName: 'Shell',
        subtitle: 'Downing St',
        pricePerGallon: 3.59,
        baselinePricePerGallon: 3.59,
        fillUpGallons: 13,
        initialDistanceMiles: 1.1,
        initialEtaMinutes: 3,
        durationSeconds: 20,
        startStatus: 'On your route',
    },
];

/**
 * Format a number of miles for display. Sub-mile values get one decimal
 * (0.8 mi), while longer distances drop the decimal on anything ≥ 10 mi
 * to avoid fake precision.
 */
function formatMiles(value) {
    if (!Number.isFinite(value)) return '0.0';
    const clamped = Math.max(0, value);
    if (clamped >= 10) return clamped.toFixed(0);
    return clamped.toFixed(1);
}

/**
 * Format ETA minutes as a whole-number string. Anything under 1 minute
 * reads as "<1" so the user sees "almost there" instead of "0".
 */
function formatEta(value) {
    if (!Number.isFinite(value) || value <= 0) return '0';
    if (value < 1) return '<1';
    return Math.round(value).toString();
}

function round2(value) {
    if (!Number.isFinite(value)) return '0.00';
    return value.toFixed(2);
}

/**
 * Compute the live activity props that correspond to a given progress
 * value (0 at start, 1 at arrival) on a given scenario.
 */
function computePropsForProgress(scenario, progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    const savingsPerGallon = Math.max(
        0,
        (scenario.baselinePricePerGallon || 0) - (scenario.pricePerGallon || 0),
    );
    const totalSavings = savingsPerGallon * (scenario.fillUpGallons || 0);

    // Linear decay on distance and ETA. Real routes are non-linear but
    // this is a visual smoke test, not a routing engine — linear makes
    // the bar + numbers move in lock-step which is nice to verify.
    const remainingDistance = scenario.initialDistanceMiles * (1 - clamped);
    const remainingEta = scenario.initialEtaMinutes * (1 - clamped);

    let status = scenario.startStatus || 'On your route';
    let phase = 'approaching';
    if (clamped >= 1) {
        status = 'Arrived';
        phase = 'arrived';
    } else if (clamped >= 0.85) {
        status = 'Almost there';
        phase = 'arriving';
    } else if (clamped >= 0.5) {
        status = 'Getting close';
        phase = 'approaching';
    }

    return {
        stationName: scenario.stationName,
        subtitle: scenario.subtitle,
        price: round2(scenario.pricePerGallon),
        savingsPerGallon: savingsPerGallon > 0 ? round2(savingsPerGallon) : '',
        totalSavings: totalSavings > 0 ? round2(totalSavings) : '',
        distanceMiles: formatMiles(remainingDistance),
        etaMinutes: formatEta(remainingEta),
        progress: clamped,
        status,
        phase,
    };
}

/**
 * Factory for a drive simulation. Returns a small controller with start /
 * stop / getState methods so the dev screen can render live progress
 * without owning its own interval.
 *
 * @param {object} options
 * @param {string} [options.scenarioId] — Which preset to run.
 * @param {function} [options.onStateChange] — Called with the latest
 *   props every tick. The dev screen uses this to mirror the activity
 *   state in SwiftUI rows.
 * @param {function} [options.onComplete] — Called once the drive reaches
 *   the station. The activity is NOT automatically ended so the user can
 *   inspect the "arrived" visuals.
 * @param {number} [options.tickIntervalMs=1000] — Tick cadence. 1 Hz is
 *   smooth and well under any Apple rate limit.
 */
function createPredictiveFuelingLiveActivitySim({
    scenarioId = SIM_SCENARIOS[0].id,
    onStateChange,
    onComplete,
    tickIntervalMs = 1000,
} = {}) {
    let scenario = SIM_SCENARIOS.find(s => s.id === scenarioId) || SIM_SCENARIOS[0];
    let instance = null;
    let intervalHandle = null;
    let startTimestamp = 0;
    let lastState = null;
    let phase = 'idle';
    // Handle returned by addLiveActivityInteractionListener — set while a
    // Live Activity is running, cleared on stop. Calling it removes the
    // underlying expo-widgets subscription.
    let removeInteractionListener = null;

    function emitState(state) {
        lastState = state;
        if (typeof onStateChange === 'function') {
            try {
                onStateChange(state);
            } catch (error) {
                console.error('onStateChange threw:', error);
            }
        }
    }

    function tick() {
        if (phase !== 'running') return;
        const elapsedMs = Date.now() - startTimestamp;
        const totalMs = scenario.durationSeconds * 1000;
        const progress = totalMs > 0 ? elapsedMs / totalMs : 1;
        const clamped = Math.max(0, Math.min(1, progress));
        const props = computePropsForProgress(scenario, clamped);

        if (instance) {
            getNotifications().updatePredictiveLiveActivity(instance, props);
        }
        emitState(props);

        if (clamped >= 1) {
            stopTicking();
            phase = 'complete';
            if (typeof onComplete === 'function') {
                try {
                    onComplete(props);
                } catch (error) {
                    console.error('onComplete threw:', error);
                }
            }
        }
    }

    function stopTicking() {
        if (intervalHandle) {
            clearInterval(intervalHandle);
            intervalHandle = null;
        }
    }

    /**
     * Start the simulation. If the activity isn't running yet we create
     * one; otherwise we just reset the clock and keep pushing updates to
     * the existing instance.
     *
     * Also wires up the Live Activity button listener: Navigate opens
     * Maps with directions to the scenario's station, Cancel stops the
     * sim and ends the activity.
     */
    function start(nextScenarioId) {
        if (nextScenarioId) {
            const next = SIM_SCENARIOS.find(s => s.id === nextScenarioId);
            if (next) scenario = next;
        }

        stopTicking();
        startTimestamp = Date.now();
        phase = 'running';

        const initialProps = computePropsForProgress(scenario, 0);
        const notifications = getNotifications();
        if (!instance) {
            instance = notifications.startPredictiveLiveActivity(initialProps);
        } else {
            notifications.updatePredictiveLiveActivity(instance, initialProps);
        }
        emitState(initialProps);

        // Tear down any stale listener from a previous run before wiring
        // up the new one — avoids stacking callbacks across Start cycles.
        if (typeof removeInteractionListener === 'function') {
            try { removeInteractionListener(); } catch (err) { /* noop */ }
            removeInteractionListener = null;
        }
        if (typeof notifications.addLiveActivityInteractionListener === 'function') {
            removeInteractionListener = notifications.addLiveActivityInteractionListener({
                onNavigate: () => {
                    notifications.openNavigationForStation({
                        name: scenario.stationName,
                        subtitle: scenario.subtitle,
                    });
                },
                onCancel: () => {
                    stop();
                },
            });
        }

        intervalHandle = setInterval(tick, tickIntervalMs);
    }

    /**
     * Stop the simulation AND end the Live Activity. Used when the user
     * taps "End Simulation" in the dev screen, or when the Cancel button
     * inside the Live Activity fires.
     */
    function stop() {
        stopTicking();
        phase = 'idle';
        if (typeof removeInteractionListener === 'function') {
            try { removeInteractionListener(); } catch (err) { /* noop */ }
            removeInteractionListener = null;
        }
        if (instance) {
            getNotifications().endLiveActivity(instance);
            instance = null;
        }
        lastState = null;
    }

    /**
     * Pause the interval without ending the activity — useful if you
     * want to inspect the activity at a specific state.
     */
    function pause() {
        if (phase !== 'running') return;
        stopTicking();
        phase = 'paused';
    }

    function resume() {
        if (phase !== 'paused') return;
        // Resume the clock by rebasing startTimestamp so the already
        // accumulated progress is preserved. Compute the remaining
        // duration from the last emitted state's progress.
        const lastProgress = lastState?.progress || 0;
        const elapsedMs = lastProgress * scenario.durationSeconds * 1000;
        startTimestamp = Date.now() - elapsedMs;
        phase = 'running';
        intervalHandle = setInterval(tick, tickIntervalMs);
    }

    function getState() {
        return {
            phase,
            scenarioId: scenario.id,
            lastState,
        };
    }

    return {
        start,
        stop,
        pause,
        resume,
        getState,
    };
}

module.exports = {
    SIM_SCENARIOS,
    computePropsForProgress,
    createPredictiveFuelingLiveActivitySim,
};
