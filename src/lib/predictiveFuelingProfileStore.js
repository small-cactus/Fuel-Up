const AsyncStorageModule = require('@react-native-async-storage/async-storage');

const AsyncStorage = AsyncStorageModule.default || AsyncStorageModule;

const PREDICTIVE_FUELING_PROFILE_STORAGE_KEY = '@fuelup/predictive-fueling-profile';
const DEFAULT_FILL_GALLONS = 11.5;

const DEFAULT_PROFILE = Object.freeze({
  preferredBrands: [],
  brandLoyalty: 0.2,
  distanceWeight: 0.5,
  priceWeight: 0.5,
  preferredGrade: 'regular',
  visitHistory: [],
  exposureHistory: [],
  routeStationHabits: {},
  routeStationExposures: {},
  fillUpHistory: [],
  typicalFillUpIntervalMiles: 280,
  rushHourPatterns: {
    morningPeak: false,
    eveningPeak: false,
  },
  estimatedMilesSinceLastFill: null,
  odometerMiles: null,
});

function toFiniteNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dedupeStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)));
}

function normalizeVisitTimestamps(values) {
  return (Array.isArray(values) ? values : [])
    .map(value => toFiniteNumber(value) || Date.parse(value))
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
    .slice(-24);
}

function normalizeContextCounts(counts) {
  if (!counts || typeof counts !== 'object') {
    return undefined;
  }
  const normalized = {};
  for (const [key, value] of Object.entries(counts)) {
    const numericValue = toFiniteNumber(value);
    normalized[key] = numericValue === null
      ? 0
      : Math.max(0, numericValue);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeVisitHistoryEntry(entry) {
  const stationId = String(entry?.stationId || '').trim();
  if (!stationId) {
    return null;
  }

  const visitCount = Math.max(1, Math.round(toFiniteNumber(entry?.visitCount) || 1));
  const lastVisitMs = toFiniteNumber(entry?.lastVisitMs) || Date.now();
  const visitTimestamps = normalizeVisitTimestamps(entry?.visitTimestamps);

  return {
    stationId,
    stationName: String(entry?.stationName || '').trim(),
    brand: String(entry?.brand || '').trim(),
    visitCount,
    lastVisitMs,
    contextCounts: normalizeContextCounts(entry?.contextCounts),
    visitTimestamps: visitTimestamps.length > 0
      ? visitTimestamps
      : [lastVisitMs],
  };
}

function normalizeExposureHistoryEntry(entry) {
  const stationId = String(entry?.stationId || '').trim();
  if (!stationId) {
    return null;
  }

  const exposureCount = Math.max(1, Math.round(toFiniteNumber(entry?.exposureCount) || 1));
  const lastExposureMs = toFiniteNumber(entry?.lastExposureMs) || Date.now();

  return {
    stationId,
    exposureCount,
    lastExposureMs,
    contextCounts: normalizeContextCounts(entry?.contextCounts),
  };
}

function normalizeRouteStationHabits(routeStationHabits) {
  if (!routeStationHabits || typeof routeStationHabits !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(routeStationHabits)
      .map(([habitKey, habitMap]) => {
        if (!habitMap || typeof habitMap !== 'object') {
          return [habitKey, {}];
        }
        const normalizedHabitMap = Object.fromEntries(
          Object.entries(habitMap)
            .map(([stationId, value]) => {
              const count = Math.max(0, Math.round(toFiniteNumber(value?.count) || 0));
              const lastVisitMs = toFiniteNumber(value?.lastVisitMs);
              if (!stationId || count <= 0 || lastVisitMs === null) {
                return null;
              }
              return [String(stationId), {
                count,
                lastVisitMs,
              }];
            })
            .filter(Boolean)
        );
        return [String(habitKey), normalizedHabitMap];
      })
      .filter(([, habitMap]) => Object.keys(habitMap).length > 0)
  );
}

function normalizeRouteStationExposures(routeStationExposures) {
  if (!routeStationExposures || typeof routeStationExposures !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(routeStationExposures)
      .map(([habitKey, exposureMap]) => {
        if (!exposureMap || typeof exposureMap !== 'object') {
          return [habitKey, {}];
        }
        const normalizedExposureMap = Object.fromEntries(
          Object.entries(exposureMap)
            .map(([stationId, value]) => {
              const count = Math.max(0, Math.round(toFiniteNumber(value?.count) || 0));
              const lastExposureMs = toFiniteNumber(value?.lastExposureMs);
              if (!stationId || count <= 0 || lastExposureMs === null) {
                return null;
              }
              return [String(stationId), {
                count,
                lastExposureMs,
              }];
            })
            .filter(Boolean)
        );
        return [String(habitKey), normalizedExposureMap];
      })
      .filter(([, exposureMap]) => Object.keys(exposureMap).length > 0)
  );
}

function normalizeFillUpHistoryEntry(entry) {
  const timestamp = toFiniteNumber(entry?.timestamp) || Date.now();
  const odometer = toFiniteNumber(entry?.odometer);
  const gallons = toFiniteNumber(entry?.gallons);
  const pricePerGallon = toFiniteNumber(entry?.pricePerGallon);

  return {
    timestamp,
    odometer: odometer === null ? undefined : odometer,
    gallons: gallons === null ? undefined : gallons,
    pricePerGallon: pricePerGallon === null ? undefined : pricePerGallon,
    stationId: String(entry?.stationId || '').trim() || undefined,
    stationName: String(entry?.stationName || '').trim() || undefined,
    brand: String(entry?.brand || '').trim() || undefined,
  };
}

function cloneDefaultProfile() {
  return {
    ...DEFAULT_PROFILE,
    preferredBrands: [],
    visitHistory: [],
    exposureHistory: [],
    routeStationHabits: {},
    routeStationExposures: {},
    fillUpHistory: [],
    rushHourPatterns: {
      ...DEFAULT_PROFILE.rushHourPatterns,
    },
  };
}

function createDefaultPredictiveFuelingProfile() {
  return cloneDefaultProfile();
}

function normalizePredictiveFuelingProfile(profile = {}) {
  const nextProfile = cloneDefaultProfile();
  const normalizedTypicalIntervalMiles = toFiniteNumber(profile?.typicalFillUpIntervalMiles);
  const normalizedEstimatedMilesSinceLastFill = toFiniteNumber(profile?.estimatedMilesSinceLastFill);
  const normalizedOdometerMiles = toFiniteNumber(profile?.odometerMiles);

  nextProfile.preferredBrands = dedupeStrings(profile?.preferredBrands);
  nextProfile.brandLoyalty = clamp(toFiniteNumber(profile?.brandLoyalty) ?? DEFAULT_PROFILE.brandLoyalty, 0, 1);
  nextProfile.distanceWeight = clamp(toFiniteNumber(profile?.distanceWeight) ?? DEFAULT_PROFILE.distanceWeight, 0, 1);
  nextProfile.priceWeight = clamp(toFiniteNumber(profile?.priceWeight) ?? DEFAULT_PROFILE.priceWeight, 0, 1);
  nextProfile.preferredGrade = String(profile?.preferredGrade || DEFAULT_PROFILE.preferredGrade);
  nextProfile.typicalFillUpIntervalMiles = Math.max(
    120,
    normalizedTypicalIntervalMiles ?? DEFAULT_PROFILE.typicalFillUpIntervalMiles
  );
  nextProfile.estimatedMilesSinceLastFill = normalizedEstimatedMilesSinceLastFill === null
    ? null
    : Math.max(0, normalizedEstimatedMilesSinceLastFill);
  nextProfile.odometerMiles = normalizedOdometerMiles === null
    ? null
    : Math.max(0, normalizedOdometerMiles);
  nextProfile.rushHourPatterns = {
    morningPeak: Boolean(profile?.rushHourPatterns?.morningPeak),
    eveningPeak: Boolean(profile?.rushHourPatterns?.eveningPeak),
  };
  nextProfile.visitHistory = (Array.isArray(profile?.visitHistory) ? profile.visitHistory : [])
    .map(normalizeVisitHistoryEntry)
    .filter(Boolean)
    .sort((left, right) => right.lastVisitMs - left.lastVisitMs)
    .slice(0, 48);
  nextProfile.exposureHistory = (Array.isArray(profile?.exposureHistory) ? profile.exposureHistory : [])
    .map(normalizeExposureHistoryEntry)
    .filter(Boolean)
    .sort((left, right) => right.lastExposureMs - left.lastExposureMs)
    .slice(0, 96);
  nextProfile.routeStationHabits = normalizeRouteStationHabits(profile?.routeStationHabits);
  nextProfile.routeStationExposures = normalizeRouteStationExposures(profile?.routeStationExposures);
  nextProfile.fillUpHistory = (Array.isArray(profile?.fillUpHistory) ? profile.fillUpHistory : [])
    .map(normalizeFillUpHistoryEntry)
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-32);

  return nextProfile;
}

async function loadPredictiveFuelingProfileAsync() {
  try {
    const rawValue = await AsyncStorage.getItem(PREDICTIVE_FUELING_PROFILE_STORAGE_KEY);
    if (!rawValue) {
      return cloneDefaultProfile();
    }

    return normalizePredictiveFuelingProfile(JSON.parse(rawValue));
  } catch (error) {
    return cloneDefaultProfile();
  }
}

async function savePredictiveFuelingProfileAsync(profile) {
  const normalizedProfile = normalizePredictiveFuelingProfile(profile);
  await AsyncStorage.setItem(
    PREDICTIVE_FUELING_PROFILE_STORAGE_KEY,
    JSON.stringify(normalizedProfile)
  );
  return normalizedProfile;
}

async function clearPredictiveFuelingProfileAsync() {
  await AsyncStorage.removeItem(PREDICTIVE_FUELING_PROFILE_STORAGE_KEY);
  return createDefaultPredictiveFuelingProfile();
}

function estimateGallonsForStop(profile) {
  const historicalGallons = (profile?.fillUpHistory || [])
    .map(entry => toFiniteNumber(entry?.gallons))
    .filter(value => value !== null && value >= 4);

  if (historicalGallons.length === 0) {
    return DEFAULT_FILL_GALLONS;
  }

  return historicalGallons.reduce((sum, value) => sum + value, 0) / historicalGallons.length;
}

function inferPreferredBrandsFromVisits(visitHistory) {
  const brandCounts = new Map();

  for (const entry of visitHistory || []) {
    const brand = String(entry?.brand || '').trim();
    if (!brand) {
      continue;
    }

    brandCounts.set(brand, (brandCounts.get(brand) || 0) + (Number(entry?.visitCount) || 0));
  }

  return Array.from(brandCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([brand]) => brand);
}

function recordStationVisit(profile, station, options = {}) {
  const normalizedProfile = normalizePredictiveFuelingProfile(profile);
  const stationId = String(station?.stationId || '').trim();
  if (!stationId) {
    return normalizedProfile;
  }

  const timestampMs = toFiniteNumber(options?.timestampMs) || Date.now();
  const didFuel = Boolean(options?.didFuel);
  const stationName = String(station?.stationName || station?.name || '').trim();
  const brand = String(station?.brand || '').trim();
  const nextVisitHistory = [...normalizedProfile.visitHistory];
  const existingVisitIndex = nextVisitHistory.findIndex(entry => entry.stationId === stationId);

  if (existingVisitIndex >= 0) {
    const existingEntry = nextVisitHistory[existingVisitIndex];
    nextVisitHistory[existingVisitIndex] = normalizeVisitHistoryEntry({
      ...existingEntry,
      stationName: stationName || existingEntry.stationName,
      brand: brand || existingEntry.brand,
      visitCount: (Number(existingEntry.visitCount) || 0) + 1,
      lastVisitMs: timestampMs,
      visitTimestamps: [
        ...(Array.isArray(existingEntry.visitTimestamps) ? existingEntry.visitTimestamps : []),
        timestampMs,
      ],
    });
  } else {
    nextVisitHistory.push(normalizeVisitHistoryEntry({
      stationId,
      stationName,
      brand,
      visitCount: 1,
      lastVisitMs: timestampMs,
      visitTimestamps: [timestampMs],
    }));
  }

  const nextProfile = normalizePredictiveFuelingProfile({
    ...normalizedProfile,
    visitHistory: nextVisitHistory,
  });

  const inferredBrands = inferPreferredBrandsFromVisits(nextProfile.visitHistory);
  nextProfile.preferredBrands = inferredBrands.length > 0
    ? inferredBrands
    : nextProfile.preferredBrands;
  const totalVisits = nextProfile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0);
  const topBrandVisitCount = nextProfile.visitHistory
    .filter(entry => inferredBrands.includes(String(entry?.brand || '').trim()))
    .reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0);
  if (totalVisits > 0 && topBrandVisitCount > 0) {
    nextProfile.brandLoyalty = clamp(topBrandVisitCount / totalVisits, 0.2, 0.95);
  }

  if (!didFuel) {
    return nextProfile;
  }

  const currentOdometerMiles = toFiniteNumber(nextProfile.odometerMiles);
  const inputOdometerMiles = toFiniteNumber(options?.odometerMiles);
  const odometerMiles = inputOdometerMiles === null
    ? currentOdometerMiles
    : Math.max(inputOdometerMiles, currentOdometerMiles ?? inputOdometerMiles);
  nextProfile.fillUpHistory = [
    ...nextProfile.fillUpHistory,
    normalizeFillUpHistoryEntry({
      timestamp: timestampMs,
      odometer: odometerMiles ?? undefined,
      gallons: toFiniteNumber(options?.gallonsEstimate) ?? estimateGallonsForStop(nextProfile),
      pricePerGallon: toFiniteNumber(options?.pricePerGallon) ?? toFiniteNumber(station?.price) ?? undefined,
      stationId,
      stationName,
      brand,
    }),
  ].slice(-32);
  nextProfile.estimatedMilesSinceLastFill = 0;
  nextProfile.odometerMiles = odometerMiles;
  nextProfile.typicalFillUpIntervalMiles = Math.max(
    120,
    toFiniteNumber(options?.typicalFillUpIntervalMiles) ?? nextProfile.typicalFillUpIntervalMiles
  );

  return normalizePredictiveFuelingProfile(nextProfile);
}

function updateProfileMileage(profile, deltaMiles) {
  const normalizedProfile = normalizePredictiveFuelingProfile(profile);
  const normalizedDeltaMiles = toFiniteNumber(deltaMiles);
  if (normalizedDeltaMiles === null || normalizedDeltaMiles <= 0) {
    return normalizedProfile;
  }

  return normalizePredictiveFuelingProfile({
    ...normalizedProfile,
    odometerMiles: toFiniteNumber(normalizedProfile.odometerMiles) === null
      ? null
      : normalizedProfile.odometerMiles + normalizedDeltaMiles,
    estimatedMilesSinceLastFill: Math.max(
      0,
      (toFiniteNumber(normalizedProfile.estimatedMilesSinceLastFill) || 0) + normalizedDeltaMiles
    ),
  });
}

module.exports = {
  createDefaultPredictiveFuelingProfile,
  clearPredictiveFuelingProfileAsync,
  DEFAULT_PROFILE,
  PREDICTIVE_FUELING_PROFILE_STORAGE_KEY,
  loadPredictiveFuelingProfileAsync,
  normalizePredictiveFuelingProfile,
  recordStationVisit,
  savePredictiveFuelingProfileAsync,
  updateProfileMileage,
};
