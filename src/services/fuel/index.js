const {
    buildBarchartUrl,
    buildCacheKey,
    buildTomTomFuelPriceUrl,
    buildTomTomPlaceUrl,
    buildTomTomSearchUrl,
    isCacheEntryFresh,
    normalizeBarchartResponse,
    normalizeTomTomStationBundle,
    pickFirstDefined,
    selectPreferredQuote,
} = require('./core');
const { getFuelServiceConfig } = require('./config');
const { getCachedEntry, setCachedEntry } = require('./cacheStore');

const inflightRequests = new Map();

async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeoutHandle);
    }
}

async function fetchTomTomQuote({ latitude, longitude, radiusMiles, fuelType, config }) {
    if (!config.tomTomApiKey) {
        return null;
    }

    const searchPayload = await fetchJson(
        buildTomTomSearchUrl({
            apiKey: config.tomTomApiKey,
            latitude,
            longitude,
            radiusMiles,
            limit: config.defaultLimit,
        }),
        config.requestTimeoutMs
    );
    const stationResults = Array.isArray(searchPayload?.results) ? searchPayload.results.slice(0, config.defaultLimit) : [];

    if (!stationResults.length) {
        return null;
    }

    const quotes = await Promise.allSettled(
        stationResults.map(async stationResult => {
            const entityId = stationResult?.id;

            if (!entityId) {
                return null;
            }

            const placePayload = await fetchJson(
                buildTomTomPlaceUrl({
                    apiKey: config.tomTomApiKey,
                    entityId,
                }),
                config.requestTimeoutMs
            );
            const placeResult = Array.isArray(placePayload?.results) ? placePayload.results[0] || null : placePayload;
            const fuelPriceId = pickFirstDefined([
                placeResult?.dataSources?.fuelPrice?.id,
                placeResult?.poi?.fuelPrice?.id,
                placeResult?.fuelPrice?.id,
            ]);

            if (!fuelPriceId) {
                return null;
            }

            const fuelPricePayload = await fetchJson(
                buildTomTomFuelPriceUrl({
                    apiKey: config.tomTomApiKey,
                    fuelPriceId,
                }),
                config.requestTimeoutMs
            );

            return normalizeTomTomStationBundle({
                origin: {
                    latitude,
                    longitude,
                },
                fuelType,
                searchResult: stationResult,
                placeResult,
                fuelPriceResult: fuelPricePayload,
            });
        })
    );

    const resolvedQuotes = quotes
        .filter(result => result.status === 'fulfilled' && result.value)
        .map(result => result.value);

    return selectPreferredQuote(resolvedQuotes);
}

async function fetchBarchartQuote({ latitude, longitude, zipCode, radiusMiles, fuelType, config }) {
    if (!config.barchartApiKey) {
        return null;
    }

    const payload = await fetchJson(
        buildBarchartUrl({
            apiKey: config.barchartApiKey,
            latitude,
            longitude,
            zipCode,
            radiusMiles,
            fuelType,
        }),
        config.requestTimeoutMs
    );

    return normalizeBarchartResponse({
        origin: {
            latitude,
            longitude,
        },
        fuelType,
        payload,
    });
}

function normalizeSnapshot({ quote, regionalQuotes, cacheKey }) {
    return {
        cacheKey,
        quote,
        regionalQuotes,
        fetchedAt: quote?.fetchedAt || new Date().toISOString(),
    };
}

async function getCachedFuelPriceSnapshot({ latitude, longitude, radiusMiles, fuelType }) {
    const cacheKey = buildCacheKey({
        latitude,
        longitude,
        radiusMiles,
        fuelType,
    });
    const cacheEntry = await getCachedEntry(cacheKey);

    if (!cacheEntry) {
        return null;
    }

    return {
        ...cacheEntry,
        isFresh: isCacheEntryFresh(cacheEntry, cacheEntry.quote?.isEstimated ? getFuelServiceConfig().areaCacheTtlMs : getFuelServiceConfig().stationCacheTtlMs),
    };
}

async function refreshFuelPriceSnapshot({ latitude, longitude, zipCode, radiusMiles, fuelType }) {
    const config = getFuelServiceConfig();
    const normalizedFuelType = fuelType || config.defaultFuelType;
    const normalizedRadius = radiusMiles || config.defaultRadiusMiles;
    const cacheKey = buildCacheKey({
        latitude,
        longitude,
        radiusMiles: normalizedRadius,
        fuelType: normalizedFuelType,
    });

    if (inflightRequests.has(cacheKey)) {
        return inflightRequests.get(cacheKey);
    }

    const request = (async () => {
        const settledResults = await Promise.allSettled([
            fetchTomTomQuote({
                latitude,
                longitude,
                radiusMiles: normalizedRadius,
                fuelType: normalizedFuelType,
                config,
            }),
            fetchBarchartQuote({
                latitude,
                longitude,
                zipCode,
                radiusMiles: normalizedRadius,
                fuelType: normalizedFuelType,
                config,
            }),
        ]);

        const quotes = settledResults
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => result.value);
        const bestQuote = selectPreferredQuote(quotes);

        if (!bestQuote) {
            throw new Error('No fuel price providers returned usable data.');
        }

        const snapshot = normalizeSnapshot({
            quote: bestQuote,
            regionalQuotes: [],
            cacheKey,
        });

        await setCachedEntry(cacheKey, snapshot);

        return snapshot;
    })().finally(() => {
        inflightRequests.delete(cacheKey);
    });

    inflightRequests.set(cacheKey, request);

    return request;
}

module.exports = {
    getCachedFuelPriceSnapshot,
    refreshFuelPriceSnapshot,
};
