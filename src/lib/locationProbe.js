/**
 * Lightweight event recorder for the location-refresh integration test.
 *
 * The location probe maintains a rolling, in-memory log of location and
 * fuel-fetch events and periodically flushes that log to a JSON file inside
 * the app's Documents directory. The test harness reads that file via
 * `xcrun simctl get_app_container booted <bundleId> data` and uses the
 * timeline to assert on cold-start latency, movement detection latency, and
 * fuel-refetch correctness.
 *
 * This module is a no-op in production builds. It only does real work when
 * `__DEV__` is true OR when it has been explicitly enabled by a test harness
 * via `enableLocationProbe()`.
 */

import * as FileSystem from 'expo-file-system/legacy';

const LOCATION_PROBE_REPORT_FILE_NAME = 'location-probe-report.json';
const MAX_EVENT_BUFFER_LENGTH = 256;
const DEFAULT_FLUSH_INTERVAL_MS = 200;

let isProbeEnabled = typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : false;
let probeSessionToken = 'auto';
let probeSessionStartAt = null;
let probeModuleEpochMs = Date.now();
let eventLog = [];
let pendingFlushTimeout = null;
let latestStateSnapshot = {
    location: null,
    lastLocationSource: null,
    lastFuelFetch: null,
    moveCount: 0,
    fuelFetchCount: 0,
    foregroundResumeCount: 0,
    launchCount: 0,
};

function getTimestampMs() {
    return Date.now();
}

function cloneForJson(value) {
    if (value == null) {
        return value;
    }

    if (typeof value !== 'object') {
        return value;
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return null;
    }
}

function getReportUri() {
    if (!FileSystem.documentDirectory) {
        return null;
    }

    return `${FileSystem.documentDirectory}${LOCATION_PROBE_REPORT_FILE_NAME}`;
}

async function writeReportAsync() {
    pendingFlushTimeout = null;

    if (!isProbeEnabled) {
        return;
    }

    const reportUri = getReportUri();

    if (!reportUri) {
        return;
    }

    const report = {
        status: probeSessionStartAt ? 'active' : 'idle',
        sessionToken: probeSessionToken,
        sessionStartAt: probeSessionStartAt,
        moduleEpochMs: probeModuleEpochMs,
        flushedAt: getTimestampMs(),
        state: cloneForJson(latestStateSnapshot),
        events: eventLog.slice(-MAX_EVENT_BUFFER_LENGTH).map(cloneForJson),
    };

    try {
        await FileSystem.writeAsStringAsync(
            reportUri,
            JSON.stringify(report, null, 2)
        );
    } catch (error) {
        // Best-effort probe output. Never crash the app on a write failure.
    }
}

function scheduleFlush() {
    if (pendingFlushTimeout != null || !isProbeEnabled) {
        return;
    }

    pendingFlushTimeout = setTimeout(() => {
        void writeReportAsync();
    }, DEFAULT_FLUSH_INTERVAL_MS);
}

export function enableLocationProbe({ token = 'auto', force = false } = {}) {
    if (!force && isProbeEnabled && probeSessionToken === token) {
        return;
    }

    isProbeEnabled = true;
    probeSessionToken = token;
    probeSessionStartAt = getTimestampMs();
    probeModuleEpochMs = getTimestampMs();
    eventLog = [];
    latestStateSnapshot = {
        location: null,
        lastLocationSource: null,
        lastFuelFetch: null,
        moveCount: 0,
        fuelFetchCount: 0,
        foregroundResumeCount: 0,
        launchCount: 0,
    };

    recordLocationProbeEvent({
        type: 'probe-enabled',
        details: { token },
    });
}

export function disableLocationProbe() {
    if (!isProbeEnabled) {
        return;
    }

    recordLocationProbeEvent({
        type: 'probe-disabled',
    });

    probeSessionStartAt = null;
    void writeReportAsync();
}

export function isLocationProbeEnabled() {
    return isProbeEnabled;
}

export function getLocationProbeReportFilename() {
    return LOCATION_PROBE_REPORT_FILE_NAME;
}

function updateStateSnapshot(event) {
    if (!event || typeof event !== 'object') {
        return;
    }

    const { type, details } = event;

    switch (type) {
        case 'location-applied': {
            if (details?.region) {
                latestStateSnapshot = {
                    ...latestStateSnapshot,
                    location: {
                        latitude: Number(details.region.latitude),
                        longitude: Number(details.region.longitude),
                    },
                    lastLocationSource: details.source || null,
                    moveCount: latestStateSnapshot.moveCount + (details.source === 'launch' ? 0 : 1),
                };
            }
            break;
        }
        case 'fuel-fetch-start': {
            latestStateSnapshot = {
                ...latestStateSnapshot,
                lastFuelFetch: {
                    phase: 'started',
                    startedAt: event.timestampMs,
                    query: cloneForJson(details?.query || null),
                },
            };
            break;
        }
        case 'fuel-fetch-end': {
            latestStateSnapshot = {
                ...latestStateSnapshot,
                lastFuelFetch: {
                    phase: details?.status || 'completed',
                    startedAt: latestStateSnapshot.lastFuelFetch?.startedAt ?? null,
                    completedAt: event.timestampMs,
                    query: cloneForJson(details?.query || null),
                    stationCount: Number.isFinite(Number(details?.stationCount))
                        ? Number(details.stationCount)
                        : 0,
                },
                fuelFetchCount: latestStateSnapshot.fuelFetchCount + 1,
            };
            break;
        }
        case 'foreground-resume': {
            latestStateSnapshot = {
                ...latestStateSnapshot,
                foregroundResumeCount: latestStateSnapshot.foregroundResumeCount + 1,
            };
            break;
        }
        case 'launch-bootstrap': {
            latestStateSnapshot = {
                ...latestStateSnapshot,
                launchCount: latestStateSnapshot.launchCount + 1,
            };
            break;
        }
        default:
            break;
    }
}

export function recordLocationProbeEvent({ type, details = null } = {}) {
    if (!isProbeEnabled || !type) {
        return;
    }

    const event = {
        type,
        timestampMs: getTimestampMs(),
        elapsedMs: probeSessionStartAt ? getTimestampMs() - probeSessionStartAt : null,
        details: cloneForJson(details),
    };

    eventLog.push(event);

    if (eventLog.length > MAX_EVENT_BUFFER_LENGTH) {
        eventLog = eventLog.slice(-MAX_EVENT_BUFFER_LENGTH);
    }

    updateStateSnapshot(event);
    scheduleFlush();
}

export async function flushLocationProbeReportAsync() {
    if (pendingFlushTimeout) {
        clearTimeout(pendingFlushTimeout);
        pendingFlushTimeout = null;
    }

    await writeReportAsync();
}

// Auto-enable the probe in dev builds so the test harness can read the report
// without having to wire up a deep link first. Production builds leave the
// probe disabled by default.
if (isProbeEnabled) {
    probeSessionStartAt = getTimestampMs();
    eventLog = [];
    recordLocationProbeEvent({
        type: 'probe-module-loaded',
    });
}
