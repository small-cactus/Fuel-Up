const AsyncStorageModule = require('@react-native-async-storage/async-storage');
const AsyncStorage = AsyncStorageModule.default || AsyncStorageModule;

const memoryCache = new Map();
// In-memory spatial index keyed by cacheKey. Each entry records the center
// point and radius of the fetched fuel window so we can reuse the cached
// snapshot as the user moves, as long as they stay inside the safe portion
// of the window. This lets the app serve nearby coordinates from a single
// cache entry instead of re-querying every time the user crosses the
// 2-decimal lat/lon bucket used by `buildCacheKey`.
const spatialCacheIndex = new Map();

// Key on each cached value that stores the spatial metadata needed to
// rehydrate the in-memory spatial index on cold launch. Persisting it
// inside the snapshot lets us skip parsing cache keys while still keeping
// the index source-of-truth in memory.
const SPATIAL_METADATA_KEY = '__fuelUpCacheWindow';

async function getMemoryEntry(key) {
    return memoryCache.get(key) || null;
}

async function setMemoryEntry(key, value) {
    memoryCache.set(key, value);
    return value;
}

async function getPersistedEntry(key) {
    try {
        const rawValue = await AsyncStorage.getItem(key);
        return rawValue ? JSON.parse(rawValue) : null;
    } catch (error) {
        return null;
    }
}

async function setPersistedEntry(key, value) {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        return value;
    }

    return value;
}

async function getCachedEntry(key) {
    const memoryEntry = await getMemoryEntry(key);

    if (memoryEntry) {
        rehydrateSpatialCacheEntry(key, memoryEntry);
        return memoryEntry;
    }

    const persistedEntry = await getPersistedEntry(key);

    if (persistedEntry) {
        await setMemoryEntry(key, persistedEntry);
        rehydrateSpatialCacheEntry(key, persistedEntry);
    }

    return persistedEntry;
}

async function setCachedEntry(key, value, spatialMetadata = null) {
    const augmentedValue = spatialMetadata
        ? {
            ...value,
            [SPATIAL_METADATA_KEY]: {
                centerLat: toFiniteNumber(spatialMetadata.centerLat),
                centerLng: toFiniteNumber(spatialMetadata.centerLng),
                radiusMiles: toFiniteNumber(spatialMetadata.radiusMiles),
                fuelType: spatialMetadata.fuelType || null,
                preferredProvider: spatialMetadata.preferredProvider || null,
                fetchedAt: toFiniteNumber(spatialMetadata.fetchedAt) ?? Date.now(),
            },
        }
        : value;

    await setMemoryEntry(key, augmentedValue);
    await setPersistedEntry(key, augmentedValue);

    if (spatialMetadata) {
        registerSpatialCacheEntry(key, spatialMetadata);
    }

    return augmentedValue;
}

async function removeCachedEntry(key) {
    memoryCache.delete(key);
    spatialCacheIndex.delete(key);

    try {
        await AsyncStorage.removeItem(key);
    } catch (error) {
        return false;
    }

    return true;
}

async function clearCachedEntries(prefix = 'fuel:') {
    memoryCache.clear();
    clearSpatialCacheIndex();

    try {
        const storedKeys = await AsyncStorage.getAllKeys();
        const matchingKeys = storedKeys.filter(key => key.startsWith(prefix));

        if (matchingKeys.length) {
            await AsyncStorage.multiRemove(matchingKeys);
        }
    } catch (error) {
        return false;
    }

    return true;
}

function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function registerSpatialCacheEntry(cacheKey, metadata) {
    if (!cacheKey || !metadata) {
        return;
    }

    const centerLat = toFiniteNumber(metadata.centerLat);
    const centerLng = toFiniteNumber(metadata.centerLng);

    if (centerLat === null || centerLng === null) {
        return;
    }

    const radiusMiles = toFiniteNumber(metadata.radiusMiles);

    spatialCacheIndex.set(cacheKey, {
        cacheKey,
        centerLat,
        centerLng,
        radiusMiles: radiusMiles !== null && radiusMiles > 0 ? radiusMiles : 10,
        fuelType: String(metadata.fuelType || '').trim().toLowerCase(),
        preferredProvider: String(metadata.preferredProvider || '').trim().toLowerCase(),
        fetchedAt: toFiniteNumber(metadata.fetchedAt) ?? Date.now(),
    });
}

function rehydrateSpatialCacheEntry(cacheKey, value) {
    if (!cacheKey || !value || typeof value !== 'object') {
        return;
    }

    if (spatialCacheIndex.has(cacheKey)) {
        return;
    }

    const metadata = value[SPATIAL_METADATA_KEY];
    if (!metadata) {
        return;
    }

    registerSpatialCacheEntry(cacheKey, metadata);
}

function listSpatialCacheEntries() {
    return Array.from(spatialCacheIndex.values());
}

function clearSpatialCacheIndex() {
    spatialCacheIndex.clear();
}

module.exports = {
    clearCachedEntries,
    clearSpatialCacheIndex,
    getCachedEntry,
    listSpatialCacheEntries,
    registerSpatialCacheEntry,
    removeCachedEntry,
    setCachedEntry,
};
