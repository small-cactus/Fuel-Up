/**
 * Simulates background station data fetches during route playback.
 * Tracks efficiency metrics: fetch count, success rate, estimated data usage, battery impact.
 */

const NETWORK_CONDITIONS = {
  good: { successRate: 1.0, latencyMs: 300, label: 'Good (LTE)' },
  spotty: { successRate: 0.55, latencyMs: 1200, label: 'Spotty (weak signal)' },
  offline: { successRate: 0.0, latencyMs: 0, label: 'Offline' },
};

const FETCH_INTERVALS_MS = {
  aggressive: 30 * 1000,    // 30s
  moderate: 60 * 1000,      // 60s (default predictiveLocation.js distanceInterval * ~2.4)
  conservative: 120 * 1000, // 2 min
  lazy: 300 * 1000,         // 5 min
};

// Estimated data per fetch (KB)
const BYTES_PER_FETCH = 8 * 1024; // 8 KB per station list response
// Estimated battery impact per fetch (mAh equivalent, very rough)
const BATTERY_COST_PER_FETCH = 0.02; // ~0.02 mAh per background wake

function createBackgroundFetchSimulator(options = {}) {
  const {
    intervalKey = 'moderate',
    networkConditionKey = 'good',
    onFetchAttempt,    // ({ success, stationCount, latencyMs, cumulativeStats }) => void
    onStationUpdate,  // ({ stationId, change: 'price_change'|'offline', newData }) => void
  } = options;

  const condition = NETWORK_CONDITIONS[networkConditionKey] || NETWORK_CONDITIONS.good;
  const intervalMs = FETCH_INTERVALS_MS[intervalKey] || FETCH_INTERVALS_MS.moderate;

  let stats = {
    fetchesAttempted: 0,
    fetchesSucceeded: 0,
    fetchesFailed: 0,
    totalDataKB: 0,
    estimatedBatteryMah: 0,
    priceChangesDetected: 0,
    stationsWentOffline: 0,
    startTime: null,
    lastFetchTime: null,
  };

  let stations = [];
  let intervalHandle = null;
  let simulatedTimeMs = 0; // tracks simulated time elapsed

  function setStations(newStations) {
    stations = newStations.map(s => ({ ...s, _offline: false }));
  }

  function simulateFetch() {
    stats.fetchesAttempted++;
    const success = Math.random() < condition.successRate;

    if (success) {
      stats.fetchesSucceeded++;
      stats.totalDataKB += BYTES_PER_FETCH / 1024;

      // Randomly simulate price change (5% chance per fetch)
      if (Math.random() < 0.05 && stations.length > 0) {
        const targetIdx = Math.floor(Math.random() * stations.length);
        const delta = (Math.random() - 0.5) * 0.12; // ±$0.06 change
        stations[targetIdx] = {
          ...stations[targetIdx],
          price: Math.round((stations[targetIdx].price + delta) * 100) / 100,
        };
        stats.priceChangesDetected++;
        if (typeof onStationUpdate === 'function') {
          onStationUpdate({
            stationId: stations[targetIdx].stationId,
            change: 'price_change',
            newData: stations[targetIdx],
          });
        }
      }

      // Randomly simulate station going offline (2% chance per fetch)
      const onlineStations = stations.filter(s => !s._offline);
      if (Math.random() < 0.02 && onlineStations.length > 1) {
        const targetIdx = Math.floor(Math.random() * onlineStations.length);
        onlineStations[targetIdx]._offline = true;
        stats.stationsWentOffline++;
        if (typeof onStationUpdate === 'function') {
          onStationUpdate({
            stationId: onlineStations[targetIdx].stationId,
            change: 'offline',
            newData: null,
          });
        }
      }
    } else {
      stats.fetchesFailed++;
    }

    stats.estimatedBatteryMah += BATTERY_COST_PER_FETCH;
    stats.lastFetchTime = simulatedTimeMs;

    if (typeof onFetchAttempt === 'function') {
      onFetchAttempt({
        success,
        stationCount: stations.filter(s => !s._offline).length,
        latencyMs: success ? condition.latencyMs : 0,
        cumulativeStats: { ...stats },
      });
    }
  }

  function start(stationList) {
    if (stationList) setStations(stationList);
    stats.startTime = Date.now();
    simulatedTimeMs = 0;
    // Don't use real timers — advance via advanceTime() for deterministic testing
  }

  // Advance simulated time by deltaMs, triggering fetches at the right intervals
  function advanceTime(deltaMs) {
    const prevTime = simulatedTimeMs;
    simulatedTimeMs += deltaMs;
    const fetchesBefore = Math.floor(prevTime / intervalMs);
    const fetchesAfter = Math.floor(simulatedTimeMs / intervalMs);
    for (let i = fetchesBefore; i < fetchesAfter; i++) {
      simulateFetch();
    }
  }

  function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
  }

  function getStats() {
    return {
      ...stats,
      successRate: stats.fetchesAttempted > 0
        ? Math.round((stats.fetchesSucceeded / stats.fetchesAttempted) * 100)
        : 0,
      interval: intervalKey,
      networkCondition: networkConditionKey,
      totalDataKB: Math.round(stats.totalDataKB * 10) / 10,
      estimatedBatteryMah: Math.round(stats.estimatedBatteryMah * 1000) / 1000,
      activeStations: stations.filter(s => !s._offline).length,
      offlineStations: stations.filter(s => s._offline).length,
    };
  }

  function getStations() {
    return stations.filter(s => !s._offline);
  }

  function reset() {
    stop();
    stats = {
      fetchesAttempted: 0,
      fetchesSucceeded: 0,
      fetchesFailed: 0,
      totalDataKB: 0,
      estimatedBatteryMah: 0,
      priceChangesDetected: 0,
      stationsWentOffline: 0,
      startTime: null,
      lastFetchTime: null,
    };
    simulatedTimeMs = 0;
    stations = []; // stationList is out of scope; reset to empty
  }

  return { start, stop, reset, advanceTime, getStats, getStations, setStations };
}

module.exports = { createBackgroundFetchSimulator, NETWORK_CONDITIONS, FETCH_INTERVALS_MS };
