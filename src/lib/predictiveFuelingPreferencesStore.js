const AsyncStorageModule = require('@react-native-async-storage/async-storage');

const AsyncStorage = AsyncStorageModule?.default || AsyncStorageModule;

const PREFERENCES_STORAGE_KEY = '@fuelup/preferences';

const DEFAULT_PREDICTIVE_PREFERENCES = Object.freeze({
  hasCompletedOnboarding: false,
  navigationApp: 'apple-maps',
  preferredOctane: 'regular',
  preferredProvider: 'gasbuddy',
  searchRadiusMiles: 10,
});

function normalizePredictiveFuelingPreferences(preferences = {}) {
  return {
    hasCompletedOnboarding: Boolean(preferences?.hasCompletedOnboarding),
    navigationApp: String(preferences?.navigationApp || DEFAULT_PREDICTIVE_PREFERENCES.navigationApp),
    preferredOctane: String(preferences?.preferredOctane || DEFAULT_PREDICTIVE_PREFERENCES.preferredOctane),
    preferredProvider: String(preferences?.preferredProvider || DEFAULT_PREDICTIVE_PREFERENCES.preferredProvider),
    searchRadiusMiles: Math.max(
      2,
      Math.min(15, Math.round(Number(preferences?.searchRadiusMiles) || DEFAULT_PREDICTIVE_PREFERENCES.searchRadiusMiles))
    ),
  };
}

async function loadPredictiveFuelingPreferencesAsync() {
  if (!AsyncStorage) {
    return normalizePredictiveFuelingPreferences(DEFAULT_PREDICTIVE_PREFERENCES);
  }

  try {
    const rawValue = await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : {};
    return normalizePredictiveFuelingPreferences({
      ...DEFAULT_PREDICTIVE_PREFERENCES,
      ...(parsedValue || {}),
    });
  } catch (error) {
    return normalizePredictiveFuelingPreferences(DEFAULT_PREDICTIVE_PREFERENCES);
  }
}

async function loadPredictiveFuelingBackgroundConfigAsync() {
  const preferences = await loadPredictiveFuelingPreferencesAsync();

  return {
    enabled: Boolean(preferences.hasCompletedOnboarding),
    preferences,
  };
}

module.exports = {
  DEFAULT_PREDICTIVE_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  loadPredictiveFuelingBackgroundConfigAsync,
  loadPredictiveFuelingPreferencesAsync,
  normalizePredictiveFuelingPreferences,
};
