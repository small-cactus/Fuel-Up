const { buildCacheKey, calculateDistanceMiles, getFuelFailureMessage, isCacheEntryFresh, selectPreferredQuote } = require('./core');
const { getFuelServiceConfig } = require('./config');
const {
    clearCachedEntries,
    flushCachedEntry,
    getCachedEntry,
    listSpatialCacheEntries,
    removeCachedEntry,
    setCachedEntry,
} = require('./cacheStore');
const {
    buildQuoteIdentity,
    sanitizeStationQuotesForFuelType,
    sanitizeSnapshotForFuelType,
    buildLatestQuotesFromRows,
} = require('./stationData');
const { fetchGasBuddyQuote } = require('./remote');
const { filterReportedSnapshot, visibleReportedQuote } = require('./reportedPrices');
const {
    annotateStationWithRouteContext,
    isTrajectoryRouteUnavailableError,
    resolveTrajectoryFetchPlanAsync,
} = require('../../lib/trajectoryFuelFetch');

const inflightRequests = new Map();
const inflightTrajectoryRequests = new Map();
const TRAJECTORY_CACHE_PREFIX = 'fuel-trajectory:';
const FUEL_CACHE_RESET_ERROR_CODE = 'FUEL_CACHE_RESET';
let fuelCacheGeneration = 0;

function createFuelCacheResetError() {
    const error = new Error('Fuel cache reset invalidated the in-flight request.');
    error.code = FUEL_CACHE_RESET_ERROR_CODE;
    return error;
}

function isFuelCacheResetError(error) {
    return error?.code === FUEL_CACHE_RESET_ERROR_CODE;
}

function normalizeSnapshot({ quote, topStations, regionalQuotes, cacheKey, trajectory = null }) {
    return {
        cacheKey,
        quote,
        topStations,
        regionalQuotes,
        trajectory,
        fetchedAt: quote?.fetchedAt || new Date().toISOString(),
    };
}

function buildTrajectorySnapshotCacheKey({
    latitude,
    longitude,
    radiusMiles,
    fuelType,
    requiresE85 = false,
    preferredProvider,
    courseDegrees,
    speedMps,
    lookaheadMeters,
}) {
    return [
        TRAJECTORY_CACHE_PREFIX,
        buildCacheKey({
            latitude,
            longitude,
            radiusMiles,
            fuelType,
            requiresE85,
            preferredProvider,
        }),
        Math.round(Number(courseDegrees) || 0),
        Math.round((Number(speedMps) || 0) * 10),
        Math.round(Number(lookaheadMeters) || 0),
    ].join('');
}

function cloneSerializable(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rebaseQuoteToOrigin(quote, origin) {
    if (!quote) {
        return null;
    }

    const normalizedQuote = cloneSerializable(quote);
    normalizedQuote.distanceMiles = calculateDistanceMiles(origin, normalizedQuote);
    return normalizedQuote;
}

function mergeTrajectorySnapshotResults({
    origin,
    baseSnapshot,
    aheadSnapshot,
    cacheKey,
    trajectoryPlan,
}) {
    const stationQuotesByIdentity = new Map();
    const regionalQuotesByIdentity = new Map();
    const route = trajectoryPlan?.route || null;
    const allStationQuotes = [
        ...(Array.isArray(baseSnapshot?.topStations) ? baseSnapshot.topStations : []),
        ...(Array.isArray(aheadSnapshot?.topStations) ? aheadSnapshot.topStations : []),
    ]
        .map(quote => rebaseQuoteToOrigin(quote, origin))
        .map(quote => annotateStationWithRouteContext({ station: quote, route, origin }));
    const allRegionalQuotes = [
        ...(Array.isArray(baseSnapshot?.regionalQuotes) ? baseSnapshot.regionalQuotes : []),
        ...(Array.isArray(aheadSnapshot?.regionalQuotes) ? aheadSnapshot.regionalQuotes : []),
    ].map(quote => rebaseQuoteToOrigin(quote, origin));

    allStationQuotes.forEach(quote => {
        const identity = buildQuoteIdentity(quote);
        const existingQuote = stationQuotesByIdentity.get(identity);
        const quoteEffectivePrice = Number.isFinite(Number(quote?.effectivePrice))
            ? Number(quote.effectivePrice)
            : Number(quote?.price);
        const existingEffectivePrice = Number.isFinite(Number(existingQuote?.effectivePrice))
            ? Number(existingQuote.effectivePrice)
            : Number(existingQuote?.price);

        if (
            !existingQuote ||
            quoteEffectivePrice < existingEffectivePrice ||
            (
                quoteEffectivePrice === existingEffectivePrice &&
                (quote.distanceMiles || Number.POSITIVE_INFINITY) < (existingQuote.distanceMiles || Number.POSITIVE_INFINITY)
            )
        ) {
            stationQuotesByIdentity.set(identity, quote);
        }
    });

    allRegionalQuotes.forEach(quote => {
        const identity = buildQuoteIdentity(quote);
        if (!regionalQuotesByIdentity.has(identity)) {
            regionalQuotesByIdentity.set(identity, quote);
        }
    });

    const topStations = Array.from(stationQuotesByIdentity.values())
        .sort((left, right) => {
            const leftEffectivePrice = Number.isFinite(Number(left?.effectivePrice)) ? Number(left.effectivePrice) : Number(left?.price);
            const rightEffectivePrice = Number.isFinite(Number(right?.effectivePrice)) ? Number(right.effectivePrice) : Number(right?.price);
            return leftEffectivePrice - rightEffectivePrice ||
                left.distanceMiles - right.distanceMiles ||
                left.price - right.price;
        });
    const regionalQuotes = Array.from(regionalQuotesByIdentity.values())
        .sort((left, right) => left.price - right.price || left.distanceMiles - right.distanceMiles);
    const quote = topStations[0] || null;

    return normalizeSnapshot({
        cacheKey,
        quote: quote || annotateStationWithRouteContext({
            station: rebaseQuoteToOrigin(baseSnapshot?.quote, origin) || rebaseQuoteToOrigin(aheadSnapshot?.quote, origin),
            route,
            origin,
        }),
        topStations,
        regionalQuotes,
        trajectory: trajectoryPlan,
    });
}

// Default portion of a cache window we consider "safe" before triggering a
// refetch. A 0.5 buffer means we refetch when the user has moved past
// halfway out from the cached center (5 miles for a 10 mile fetch). This
// keeps a fresh roll of stations around the user as they move — waiting
// until they were near the outer ring left the home feed sparse for too
// long, because stations on the "behind" side of the original fetch kept
// getting farther from the user until the refetch finally fired.
const DEFAULT_CACHE_EDGE_BUFFER_FRACTION = 0.5;

function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
    const latA = Number(lat1);
    const lngA = Number(lng1);
    const latB = Number(lat2);
    const lngB = Number(lng2);

    if (
        !Number.isFinite(latA) ||
        !Number.isFinite(lngA) ||
        !Number.isFinite(latB) ||
        !Number.isFinite(lngB)
    ) {
        return Number.POSITIVE_INFINITY;
    }

    const earthRadiusMiles = 3958.7613;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const deltaLat = toRadians(latB - latA);
    const deltaLng = toRadians(lngB - lngA);
    const haversineA = (
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(toRadians(latA)) *
        Math.cos(toRadians(latB)) *
        Math.sin(deltaLng / 2) ** 2
    );
    const haversineC = 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));

    return earthRadiusMiles * haversineC;
}

/**
 * Scan the in-memory spatial cache index for an entry whose fetched window
 * still covers the requested origin. Returns the metadata for the best match
 * (closest center) or `null` if no window is usable. A match must:
 *   - target the same fuel type and preferred provider
 *   - be within `radiusMiles * (1 - edgeBufferFraction)` of the origin
 *   - still be fresh according to the TTL for station/area snapshots
 */
function findUsableCachedFuelWindow({
    latitude,
    longitude,
    fuelType,
    requiresE85 = false,
    preferredProvider,
    radiusMiles,
    edgeBufferFraction = DEFAULT_CACHE_EDGE_BUFFER_FRACTION,
    nowMs = Date.now(),
}) {
    const latitudeNumber = Number(latitude);
    const longitudeNumber = Number(longitude);
    if (!Number.isFinite(latitudeNumber) || !Number.isFinite(longitudeNumber)) {
        return null;
    }

    const normFuelType = String(fuelType || '').trim().toLowerCase();
    const normProvider = 'gasbuddy';
    const bufferFraction = Math.max(0, Math.min(0.95, Number(edgeBufferFraction) || 0));
    const requestedRadius = Number(radiusMiles);
    preferredProvider = 'gasbuddy';
    const config = getFuelServiceConfig();
    const stationTtlMs = Number(config.stationCacheTtlMs) || 0;
    const areaTtlMs = Number(config.areaCacheTtlMs) || 0;
    // We cannot tell from the spatial entry alone whether the underlying
    // snapshot was a station or area fetch, so we treat any entry as usable
    // if it is still inside the more generous of the two TTLs. The downstream
    // snapshot loader re-checks the precise TTL before returning data.
    const effectiveTtlMs = Math.max(stationTtlMs, areaTtlMs);

    let bestMatch = null;

    for (const entry of listSpatialCacheEntries()) {
        if (!entry.cacheKey?.startsWith('fuel-national-reported-v5:')) continue;
        if (Boolean(entry.requiresE85) !== Boolean(requiresE85)) continue;
        if (normFuelType && entry.fuelType && entry.fuelType !== normFuelType) {
            continue;
        }
        if (normProvider && entry.preferredProvider && entry.preferredProvider !== normProvider) {
            continue;
        }

        // Only reuse a window if the cached query radius is at least as big as
        // what the caller currently wants; otherwise we could miss stations the
        // new request would have picked up on the outer ring.
        if (Number.isFinite(requestedRadius) && entry.radiusMiles < requestedRadius) {
            continue;
        }

        // Skip windows that have aged past the cache TTL. Without this, the
        // home screen tracker would happily skip refetches against stale
        // snapshots and the UI would drift out of sync with the real prices.
        if (effectiveTtlMs > 0 && entry.fetchedAt) {
            const ageMs = nowMs - entry.fetchedAt;
            if (!Number.isFinite(ageMs) || ageMs > effectiveTtlMs) {
                continue;
            }
        }

        const distanceMiles = haversineDistanceMiles(
            latitudeNumber,
            longitudeNumber,
            entry.centerLat,
            entry.centerLng
        );
        const safeRadius = entry.radiusMiles * (1 - bufferFraction);

        if (Number.isFinite(requestedRadius) && distanceMiles + requestedRadius > entry.radiusMiles + 0.000001) continue;

        if (distanceMiles > safeRadius) {
            continue;
        }

        if (!bestMatch || distanceMiles < bestMatch.distanceMiles) {
            bestMatch = {
                ...entry,
                distanceMiles,
                safeRadius,
                ttlMs: effectiveTtlMs,
                isWithinWindow: true,
                nowMs,
            };
        }
    }

    return bestMatch;
}

/**
 * Locate the best cached snapshot whose fetched window still contains the
 * caller's origin, rebase the quote distances to the new origin, and tag the
 * result with `reusedWindow` metadata so the caller knows the entry was
 * served from the spatial cache instead of an exact-key lookup.
 */
async function findUsableCachedFuelSnapshot({
    latitude,
    longitude,
    radiusMiles,
    fuelType,
    requiresE85 = false,
    preferredProvider = 'gasbuddy',
    edgeBufferFraction = DEFAULT_CACHE_EDGE_BUFFER_FRACTION,
}) {
    const window = findUsableCachedFuelWindow({
        latitude,
        longitude,
        fuelType,
        requiresE85,
        preferredProvider,
        radiusMiles,
        edgeBufferFraction,
    });

    if (!window) {
        return null;
    }

    const cacheEntry = await getCachedEntry(window.cacheKey);

    if (!cacheEntry) {
        return null;
    }

    preferredProvider = 'gasbuddy';
    const config = getFuelServiceConfig();
    const ttlMs = cacheEntry.quote?.isEstimated ? config.areaCacheTtlMs : config.stationCacheTtlMs;

    if (!isCacheEntryFresh(cacheEntry, ttlMs)) {
        return null;
    }

    const origin = { latitude, longitude };
    const insideRadius = quote => quote && quote.distanceMiles <= Number(radiusMiles || config.defaultRadiusMiles);
    const originalBest = rebaseQuoteToOrigin(cacheEntry.quote, origin);
    const rebasedTopStations = Array.isArray(cacheEntry.topStations)
        ? cacheEntry.topStations.map(quote => rebaseQuoteToOrigin(quote, origin)).filter(insideRadius)
        : [];
    const rebasedQuote = selectPreferredQuote([...rebasedTopStations, originalBest].filter(insideRadius));
    const rebasedRegionalQuotes = Array.isArray(cacheEntry.regionalQuotes)
        ? cacheEntry.regionalQuotes.map(quote => rebaseQuoteToOrigin(quote, origin)).filter(insideRadius)
        : [];

    return filterReportedSnapshot(sanitizeSnapshotForFuelType({
        ...cacheEntry,
        quote: rebasedQuote,
        topStations: rebasedTopStations,
        regionalQuotes: rebasedRegionalQuotes,
        isFresh: true,
        reusedWindow: {
            cacheKey: window.cacheKey,
            centerLat: window.centerLat,
            centerLng: window.centerLng,
            radiusMiles: window.radiusMiles,
            distanceMiles: window.distanceMiles,
            safeRadius: window.safeRadius,
            edgeBufferFraction,
            fetchedAt: window.fetchedAt,
        },
    }, fuelType));
}

async function getCachedFuelPriceSnapshot({ latitude, longitude, radiusMiles, fuelType, requiresE85 = false, preferredProvider = 'gasbuddy' }) {
    // First try the spatial lookup so we can reuse an already-fetched window
    // when the user is still inside the safe portion of it. Falling back to
    // the exact cache key keeps the existing behavior intact when the spatial
    // index is cold (e.g. right after a cold launch before any new fetches).
    const spatialSnapshot = await findUsableCachedFuelSnapshot({
        latitude,
        longitude,
        radiusMiles,
        fuelType,
        requiresE85,
        preferredProvider,
    });

    if (spatialSnapshot) {
        return spatialSnapshot;
    }

    const cacheKey = buildCacheKey({
        latitude,
        longitude,
        radiusMiles,
        fuelType,
        requiresE85,
        preferredProvider,
    });
    const cacheEntry = await getCachedEntry(cacheKey);

    if (!cacheEntry) {
        return null;
    }

    return filterReportedSnapshot(sanitizeSnapshotForFuelType({
        ...cacheEntry,
        isFresh: isCacheEntryFresh(
            cacheEntry,
            cacheEntry.quote?.isEstimated ? getFuelServiceConfig().areaCacheTtlMs : getFuelServiceConfig().stationCacheTtlMs
        ),
    }, fuelType));
}

/**
 * Decide whether the caller still has a usable cached window around `origin`
 * without fetching anything. The home screen uses this to keep cache returns
 * minimal while the user is moving — we only schedule a refetch when the
 * user passes the safe edge of the last fetched window.
 */
function hasUsableCachedFuelWindow({
    latitude,
    longitude,
    radiusMiles,
    fuelType,
    requiresE85 = false,
    preferredProvider,
    edgeBufferFraction,
}) {
    return Boolean(findUsableCachedFuelWindow({
        latitude,
        longitude,
        radiusMiles,
        fuelType,
        requiresE85,
        preferredProvider,
        edgeBufferFraction,
    }));
}

async function refreshFuelPriceSnapshot({
    latitude,
    longitude,
    zipCode,
    radiusMiles,
    fuelType,
    requiresE85 = false,
    preferredProvider,
    forceLiveGasBuddy = false,
    // `allowLiveGasBuddy` is accepted for backwards compatibility with the
    // dev tab and any external callers that still pass it, but it is a
    // no-op now: the cache-miss path inside `fetchGasBuddyQuote` always
    // triggers a live fetch regardless of this flag.
    // eslint-disable-next-line no-unused-vars
    allowLiveGasBuddy = false,
}) {
    preferredProvider = 'gasbuddy';
    const config = getFuelServiceConfig();
    const normalizedFuelType = fuelType || config.defaultFuelType;
    const normalizedRadius = radiusMiles || config.defaultRadiusMiles;
    const cacheKey = buildCacheKey({
        latitude,
        longitude,
        radiusMiles: normalizedRadius,
        fuelType: normalizedFuelType, requiresE85,
        preferredProvider,
    });

    if (inflightRequests.has(cacheKey)) {
        return inflightRequests.get(cacheKey);
    }

    const requestGeneration = fuelCacheGeneration;
    let request;

    request = (async () => {
        const debugState = {
            input: {
                fuelType: normalizedFuelType, requiresE85,
                latitude,
                longitude,
                radiusMiles: normalizedRadius,
                zipCode: zipCode || null,
            },
            providers: [],
            requestedAt: new Date().toISOString(),
        };

        const providerResults = [await fetchGasBuddyQuote({
            latitude, longitude, radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType, requiresE85, config, forceLive: forceLiveGasBuddy,
        })];

        debugState.providers = providerResults.map(result => result.debugEntry);

        let allQuotes = sanitizeStationQuotesForFuelType(
            providerResults.flatMap(result => result.quotes || result.quote || []).map(quote => visibleReportedQuote(quote)).filter(Boolean),
            normalizedFuelType
        );
        const stationQuotes = allQuotes.filter(quote => quote.providerTier === 'station' && !quote.isEstimated);

        const uniqueQuotesMap = new Map();
        stationQuotes.forEach(q => {
            const id = buildQuoteIdentity(q);

            if (!id) {
                return;
            }

            if (!uniqueQuotesMap.has(id) || (q.price != null && (uniqueQuotesMap.get(id).price == null || q.price < uniqueQuotesMap.get(id).price))) {
                uniqueQuotesMap.set(id, q);
            }
        });

        const topStations = Array.from(uniqueQuotesMap.values())
            .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.distanceMiles - b.distanceMiles);
        const dedupedStationCount = stationQuotes.length - uniqueQuotesMap.size;

        debugState.summary = {
            stationQuoteCount: stationQuotes.length,
            uniqueStationQuoteCount: uniqueQuotesMap.size,
            dedupedStationCount,
            adjustedStationQuoteCount: stationQuotes.filter(quote => quote?.validation?.usedPrediction).length,
        };

        if (__DEV__ && dedupedStationCount > 0) {
            console.log(
                `[FuelUp][Aggregation] deduped ${dedupedStationCount} station quotes (input=${stationQuotes.length}, unique=${uniqueQuotesMap.size})`
            );
        }

        const bestQuote = selectPreferredQuote(allQuotes);
        const supplementalQuotes = allQuotes.filter(quote => quote.providerTier === 'area');

        if (!bestQuote && debugState.providers?.[0]?.summary?.source !== 'national-cache') {
            const requestError = new Error('No fuel price providers returned usable data.');
            requestError.debugState = debugState;
            requestError.userMessage = getFuelFailureMessage({ debugState });
            throw requestError;
        }

        const snapshot = sanitizeSnapshotForFuelType(normalizeSnapshot({
            cacheKey,
            quote: bestQuote,
            topStations,
            regionalQuotes: supplementalQuotes,
        }), normalizedFuelType);

        if (requestGeneration !== fuelCacheGeneration) {
            throw createFuelCacheResetError();
        }

        await setCachedEntry(cacheKey, snapshot, {
            centerLat: latitude,
            centerLng: longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType, requiresE85,
            preferredProvider,
            fetchedAt: Date.now(),
        });

        if (requestGeneration !== fuelCacheGeneration) {
            await removeCachedEntry(cacheKey);
            throw createFuelCacheResetError();
        }

        return {
            debugState,
            snapshot,
        };
    })().finally(() => {
        if (inflightRequests.get(cacheKey) === request) {
            inflightRequests.delete(cacheKey);
        }
    });

    inflightRequests.set(cacheKey, request);

    return request;
}

async function refreshFuelPriceSnapshotAlongTrajectory({
    latitude,
    longitude,
    courseDegrees,
    speedMps,
    radiusMiles,
    fuelType,
    requiresE85 = false,
    preferredProvider,
    routeProvider,
    lookaheadMeters,
    routeTargetMeters,
    forceLiveGasBuddy = false,
    allowLiveGasBuddy = false,
    snapshotFetcher = refreshFuelPriceSnapshot,
    cacheWriter = setCachedEntry,
}) {
    const normalizedFuelType = fuelType || getFuelServiceConfig().defaultFuelType;
    const normalizedRadius = radiusMiles || getFuelServiceConfig().defaultRadiusMiles;
    const trajectoryCacheKey = [
        'trajectory',
        buildCacheKey({
            latitude,
            longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType, requiresE85,
            preferredProvider,
        }),
        Math.round(Number(courseDegrees) || 0),
        Math.round((Number(speedMps) || 0) * 10),
        Math.round(Number(lookaheadMeters) || 0),
    ].join(':');

    if (inflightTrajectoryRequests.has(trajectoryCacheKey)) {
        return inflightTrajectoryRequests.get(trajectoryCacheKey);
    }

    const requestGeneration = fuelCacheGeneration;
    let request;

    request = (async () => {
        const trajectoryPlan = await resolveTrajectoryFetchPlanAsync({
            latitude,
            longitude,
            courseDegrees,
            speedMps,
            lookaheadMeters,
            routeTargetMeters,
            routeProvider,
        });
        if (!trajectoryPlan?.aheadPoint) {
            throw new Error('MapKit could not build a trajectory fetch plan.');
        }

        const baseQuery = {
            latitude,
            longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType, requiresE85,
            preferredProvider,
            forceLiveGasBuddy,
            allowLiveGasBuddy,
        };
        const aheadQuery = {
            ...baseQuery,
            latitude: trajectoryPlan.aheadPoint.latitude,
            longitude: trajectoryPlan.aheadPoint.longitude,
        };
        const [baseResult, aheadResult] = await Promise.all([
            snapshotFetcher(baseQuery),
            snapshotFetcher(aheadQuery),
        ]);
        const cacheKey = buildCacheKey({
            latitude,
            longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType, requiresE85,
            preferredProvider,
        });
        const trajectorySnapshotCacheKey = buildTrajectorySnapshotCacheKey({
            latitude,
            longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType, requiresE85,
            preferredProvider,
            courseDegrees,
            speedMps,
            lookaheadMeters: trajectoryPlan.lookaheadMeters,
        });
        const mergedSnapshot = sanitizeSnapshotForFuelType(mergeTrajectorySnapshotResults({
            origin: trajectoryPlan.origin,
            baseSnapshot: baseResult?.snapshot,
            aheadSnapshot: aheadResult?.snapshot,
            cacheKey: trajectorySnapshotCacheKey,
            trajectoryPlan: {
                aheadPoint: trajectoryPlan.aheadPoint,
                lookaheadMeters: trajectoryPlan.lookaheadMeters,
                routeDistanceMeters: trajectoryPlan.routeDistanceMeters,
                projectedDestination: trajectoryPlan.projectedDestination,
                route: trajectoryPlan.route,
                routeStepCount: Array.isArray(trajectoryPlan.route?.steps) ? trajectoryPlan.route.steps.length : 0,
            },
        }), normalizedFuelType);
        const debugState = {
            input: {
                ...baseQuery,
                courseDegrees,
                speedMps,
            },
            providers: [
                ...((baseResult?.debugState?.providers || []).map(provider => ({
                    ...provider,
                    trajectoryPoint: 'origin',
                }))),
                ...((aheadResult?.debugState?.providers || []).map(provider => ({
                    ...provider,
                    trajectoryPoint: 'ahead',
                }))),
            ],
            requestedAt: new Date().toISOString(),
            summary: {
                baseStationCount: Array.isArray(baseResult?.snapshot?.topStations) ? baseResult.snapshot.topStations.length : 0,
                aheadStationCount: Array.isArray(aheadResult?.snapshot?.topStations) ? aheadResult.snapshot.topStations.length : 0,
                mergedStationCount: Array.isArray(mergedSnapshot?.topStations) ? mergedSnapshot.topStations.length : 0,
            },
            trajectory: mergedSnapshot?.trajectory || null,
        };

        if (requestGeneration !== fuelCacheGeneration) {
            throw createFuelCacheResetError();
        }

        await cacheWriter(trajectorySnapshotCacheKey, mergedSnapshot, {
            centerLat: latitude,
            centerLng: longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType, requiresE85,
            preferredProvider,
            fetchedAt: Date.now(),
        });

        if (requestGeneration !== fuelCacheGeneration) {
            await removeCachedEntry(trajectorySnapshotCacheKey);
            throw createFuelCacheResetError();
        }

        return {
            debugState,
            snapshot: mergedSnapshot,
            trajectoryPlan,
        };
    })().finally(() => {
        if (inflightTrajectoryRequests.get(trajectoryCacheKey) === request) {
            inflightTrajectoryRequests.delete(trajectoryCacheKey);
        }
    });

    inflightTrajectoryRequests.set(trajectoryCacheKey, request);
    return request;
}

async function refreshFuelPriceSnapshotWithTrajectoryFallback({
    courseDegrees,
    speedMps,
    routeProvider,
    lookaheadMeters,
    routeTargetMeters,
    fallbackSnapshotFetcher = refreshFuelPriceSnapshot,
    ...baseQuery
}) {
    try {
        return await refreshFuelPriceSnapshotAlongTrajectory({
            ...baseQuery,
            courseDegrees,
            speedMps,
            routeProvider,
            lookaheadMeters,
            routeTargetMeters,
        });
    } catch (error) {
        if (!isTrajectoryRouteUnavailableError(error)) {
            throw error;
        }

        return fallbackSnapshotFetcher(baseQuery);
    }
}

async function clearFuelPriceCache() {
    fuelCacheGeneration += 1;
    inflightRequests.clear();
    inflightTrajectoryRequests.clear();
    await clearCachedEntries('fuel:');
    return clearCachedEntries(TRAJECTORY_CACHE_PREFIX);
}

module.exports = {
    flushCachedEntry,
    buildLatestFuelStationQuotesFromRows: buildLatestQuotesFromRows,
    clearFuelPriceCache,
    findUsableCachedFuelSnapshot,
    getFuelFailureMessage,
    getCachedFuelPriceSnapshot,
    hasUsableCachedFuelWindow,
    isFuelCacheResetError,
    refreshFuelPriceSnapshot,
    refreshFuelPriceSnapshotAlongTrajectory,
    refreshFuelPriceSnapshotWithTrajectoryFallback,
};
