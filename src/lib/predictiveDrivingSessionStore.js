const AsyncStorageModule = require('@react-native-async-storage/async-storage');

const AsyncStorage = AsyncStorageModule?.default || AsyncStorageModule;

const PREDICTIVE_DRIVING_SESSION_KEY = '@fuelup/predictive-driving-session';

function normalizePredictiveDrivingSession(session = {}) {
  const lastAutomotiveAt = Number(session?.lastAutomotiveAt);

  return {
    lastAutomotiveAt: Number.isFinite(lastAutomotiveAt) && lastAutomotiveAt > 0
      ? lastAutomotiveAt
      : null,
  };
}

async function loadPredictiveDrivingSessionAsync() {
  if (!AsyncStorage) {
    return normalizePredictiveDrivingSession();
  }

  try {
    const rawValue = await AsyncStorage.getItem(PREDICTIVE_DRIVING_SESSION_KEY);
    return normalizePredictiveDrivingSession(rawValue ? JSON.parse(rawValue) : {});
  } catch (error) {
    return normalizePredictiveDrivingSession();
  }
}

async function savePredictiveDrivingSessionAsync(session = {}) {
  const normalizedSession = normalizePredictiveDrivingSession(session);

  if (!AsyncStorage) {
    return normalizedSession;
  }

  await AsyncStorage.setItem(PREDICTIVE_DRIVING_SESSION_KEY, JSON.stringify(normalizedSession));
  return normalizedSession;
}

async function markPredictiveDrivingAutomotiveAsync(timestamp) {
  const resolvedTimestamp = Number(timestamp);
  if (!Number.isFinite(resolvedTimestamp) || resolvedTimestamp <= 0) {
    return loadPredictiveDrivingSessionAsync();
  }

  return savePredictiveDrivingSessionAsync({
    lastAutomotiveAt: resolvedTimestamp,
  });
}

async function clearPredictiveDrivingSessionAsync() {
  if (!AsyncStorage) {
    return;
  }

  await AsyncStorage.removeItem(PREDICTIVE_DRIVING_SESSION_KEY);
}

module.exports = {
  clearPredictiveDrivingSessionAsync,
  loadPredictiveDrivingSessionAsync,
  markPredictiveDrivingAutomotiveAsync,
  normalizePredictiveDrivingSession,
  savePredictiveDrivingSessionAsync,
};
