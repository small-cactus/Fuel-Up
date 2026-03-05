const {
    buildBarchartUrl,
    buildCacheKey,
    buildCardogUrl,
    buildGasBuddyGraphQLRequest,
    buildGoogleNearbySearchRequest,
    calculateDistanceMiles,
    buildTomTomFuelPriceUrl,
    buildTomTomPlaceUrl,
    buildTomTomSearchUrl,
    getFuelFailureMessage,
    isCacheEntryFresh,
    normalizeBarchartResponse,
    normalizeBlsResponse,
    normalizeCardogResponse,
    normalizeEiaResponse,
    normalizeFredResponse,
    normalizeGasBuddyResponse,
    normalizeGooglePlacesResponse,
    normalizeTomTomStationBundle,
    pickFirstDefined,
    selectPreferredQuote,
} = require('./core');
const { BLS_SERIES_BY_FUEL, EIA_PRODUCT_BY_FUEL, FRED_SERIES_BY_FUEL, getFuelServiceConfig } = require('./config');
const { clearCachedEntries, getCachedEntry, setCachedEntry } = require('./cacheStore');

const inflightRequests = new Map();

function redactUrl(url) {
    return String(url || '').replace(/([?&](?:key|apikey|api_key)=)[^&]+/gi, '$1REDACTED');
}

function createDebugEntry(providerId, providerTier, enabled) {
    return {
        providerId,
        providerTier,
        enabled,
        failureCategory: null,
        quoteReturned: false,
        requests: [],
        summary: {},
        error: null,
    };
}

function createDebugRequest({ step, url, status, output, error }) {
    return {
        step,
        url: redactUrl(url),
        status: status || null,
        output: output ?? null,
        error: error || null,
    };
}

function describeFetchError(error) {
    if (typeof error?.payload === 'string') {
        return error.payload;
    }

    if (error?.payload) {
        try {
            return JSON.stringify(error.payload);
        } catch (stringifyError) {
            return error.message || 'Request failed';
        }
    }

    return error?.message || 'Request failed';
}

function buildQuoteIdentity(quote) {
    if (!quote) {
        return '';
    }

    const providerId = String(quote.providerId || 'unknown');
    const stationId = quote.stationId ? String(quote.stationId) : '';

    if (stationId) {
        return `${providerId}:${stationId}`;
    }

    const latitude = Number(quote.latitude);
    const longitude = Number(quote.longitude);

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return `${providerId}:coord:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    }

    return `${providerId}:${String(quote.stationName || 'station')}:${String(quote.address || 'address')}`;
}

function toPositiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function pickPreferredStoredPrice(entry) {
    if (entry === null || entry === undefined) {
        return null;
    }

    if (typeof entry === 'number' || typeof entry === 'string') {
        return toPositiveNumber(entry);
    }

    if (typeof entry !== 'object') {
        return null;
    }

    const creditPrice = toPositiveNumber(entry.credit);
    if (creditPrice !== null) {
        return creditPrice;
    }

    const cashPrice = toPositiveNumber(entry.cash);
    if (cashPrice !== null) {
        return cashPrice;
    }

    const directPrice = toPositiveNumber(entry.price);
    if (directPrice !== null) {
        return directPrice;
    }

    const valuePrice = toPositiveNumber(entry.value);
    if (valuePrice !== null) {
        return valuePrice;
    }

    return toPositiveNumber(entry.amount);
}

function resolveStoredFuelPrice({ allPrices, fuelType }) {
    if (!allPrices || typeof allPrices !== 'object') {
        return null;
    }

    const normalizedFuelType = String(fuelType || '').toLowerCase();
    const aliasesByFuelType = {
        regular: ['regular', 'regular_gas'],
        midgrade: ['midgrade', 'midgrade_gas'],
        premium: ['premium', 'premium_gas'],
        diesel: ['diesel'],
    };

    const aliases = aliasesByFuelType[normalizedFuelType] || [normalizedFuelType];
    const paymentMap = allPrices._payment && typeof allPrices._payment === 'object'
        ? allPrices._payment
        : {};

    for (const alias of aliases) {
        const paymentPrice = pickPreferredStoredPrice(paymentMap[alias]);
        if (paymentPrice !== null) {
            return paymentPrice;
        }
    }

    for (const alias of aliases) {
        const directPrice = pickPreferredStoredPrice(allPrices[alias]);
        if (directPrice !== null) {
            return directPrice;
        }
    }

    return null;
}

function normalizeStoredAllPrices(allPrices) {
    const normalized = {};
    const fuelTypes = ['regular', 'midgrade', 'premium', 'diesel'];

    for (const fuelType of fuelTypes) {
        const resolved = resolveStoredFuelPrice({ allPrices, fuelType });
        if (resolved !== null) {
            normalized[fuelType] = resolved;
        }
    }

    return normalized;
}

function buildLatestQuotesFromRows({ rows, origin, fallbackSourceLabel }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    const sortedRows = [...rows].sort((left, right) => {
        const leftTime = Date.parse(left?.created_at || '') || 0;
        const rightTime = Date.parse(right?.created_at || '') || 0;
        return rightTime - leftTime;
    });
    const latestByIdentity = new Map();

    for (const row of sortedRows) {
        const quote = mapStationPriceRowToQuote({ row, origin, fallbackSourceLabel });
        const identity = buildQuoteIdentity(quote);

        if (!quote || !identity || latestByIdentity.has(identity)) {
            continue;
        }

        latestByIdentity.set(identity, quote);
    }

    return Array.from(latestByIdentity.values());
}

function mapStationPriceRowToQuote({ row, origin, fallbackSourceLabel }) {
    if (!row) {
        return null;
    }

    const normalizedAllPrices = normalizeStoredAllPrices(row.all_prices);
    const fuelType = String(row.fuel_type || 'regular').toLowerCase();
    const parsedPrice = resolveStoredFuelPrice({ allPrices: row.all_prices, fuelType }) ?? toPositiveNumber(row.price);
    const hasValidPrice = parsedPrice !== null;

    if (!hasValidPrice) {
        return null;
    }

    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
    const stationCoords = hasCoordinates
        ? { latitude, longitude }
        : { latitude: origin.latitude, longitude: origin.longitude };

    return {
        providerId: row.provider_id || 'gasbuddy',
        providerTier: 'station',
        stationId: row.station_id ? String(row.station_id) : '',
        stationName: row.station_name,
        address: row.address,
        latitude: stationCoords.latitude,
        longitude: stationCoords.longitude,
        fuelType,
        price: parsedPrice,
        allPrices: Object.keys(normalizedAllPrices).length
            ? normalizedAllPrices
            : { [fuelType]: parsedPrice },
        currency: row.currency,
        priceUnit: 'gallon',
        distanceMiles: calculateDistanceMiles(origin, stationCoords),
        fetchedAt: new Date().toISOString(),
        updatedAt: row.updated_at_source || null,
        isEstimated: false,
        sourceLabel: fallbackSourceLabel || row.source_label || PROVIDER_LABELS.gasbuddy,
        rating: row.rating ? Number(row.rating) : null,
        userRatingCount: row.user_rating_count ? Number(row.user_rating_count) : null,
    };
}

function buildBlsUrl({ fuelType }) {
    const seriesId = BLS_SERIES_BY_FUEL[fuelType] || BLS_SERIES_BY_FUEL.regular;
    return `https://api.bls.gov/publicAPI/v2/timeseries/data/${seriesId}?latest=true`;
}

function buildEiaUrl({ apiKey, fuelType }) {
    const params = new URLSearchParams();
    params.set('api_key', apiKey);
    params.set('frequency', 'weekly');
    params.set('data[0]', 'value');
    params.set('facets[product][]', EIA_PRODUCT_BY_FUEL[fuelType] || EIA_PRODUCT_BY_FUEL.regular);
    params.set('facets[duoarea][]', 'NUS');
    params.set('sort[0][column]', 'period');
    params.set('sort[0][direction]', 'desc');
    params.set('offset', '0');
    params.set('length', '1');

    return `https://api.eia.gov/v2/petroleum/pri/gnd/data/?${params.toString()}`;
}

function buildFredUrl({ apiKey, fuelType }) {
    const params = new URLSearchParams({
        series_id: FRED_SERIES_BY_FUEL[fuelType] || FRED_SERIES_BY_FUEL.regular,
        api_key: apiKey,
        file_type: 'json',
        sort_order: 'desc',
        limit: '1',
    });

    return `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
}

async function fetchJson(url, options = {}) {
    const normalizedOptions = typeof options === 'number' ? { timeoutMs: options } : options;
    const {
        body,
        headers = {},
        method = 'GET',
        timeoutMs,
    } = normalizedOptions;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            body: body ? JSON.stringify(body) : undefined,
            headers: {
                Accept: 'application/json',
                ...headers,
            },
            method,
            signal: controller.signal,
        });
        const rawBody = await response.text();
        let payload = null;

        try {
            payload = rawBody ? JSON.parse(rawBody) : null;
        } catch (error) {
            payload = rawBody || null;
        }

        if (!response.ok) {
            const requestError = new Error(`HTTP ${response.status}`);
            requestError.status = response.status;
            requestError.payload = payload;
            throw requestError;
        }

        return {
            payload,
            status: response.status,
        };
    } finally {
        clearTimeout(timeoutHandle);
    }
}

async function fetchTomTomQuote({ latitude, longitude, radiusMiles, fuelType, config }) {
    const debugEntry = createDebugEntry('tomtom', 'station', Boolean(config.tomTomApiKey));

    if (!config.tomTomApiKey) {
        debugEntry.error = 'TomTom API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const searchUrl = buildTomTomSearchUrl({
        apiKey: config.tomTomApiKey,
        latitude,
        longitude,
        radiusMiles,
        limit: config.defaultLimit,
    });

    try {
        const searchResponse = await fetchJson(searchUrl, config.requestTimeoutMs);

        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat('tomtom');

        debugEntry.requests.push(
            createDebugRequest({
                step: 'categorySearch',
                url: searchUrl,
                status: searchResponse.status,
                output: searchResponse.payload,
            })
        );

        const stationResults = Array.isArray(searchResponse.payload?.results)
            ? searchResponse.payload.results.slice(0, config.defaultLimit)
            : [];

        debugEntry.summary.searchResultCount = stationResults.length;

        if (!stationResults.length) {
            debugEntry.error = 'The search request returned no nearby stations.';
            debugEntry.failureCategory = 'location';
            return { debugEntry, quote: null };
        }

        const quotes = await Promise.all(
            stationResults.map(async stationResult => {
                const entityId = stationResult?.id;

                if (!entityId) {
                    return null;
                }

                const placeUrl = buildTomTomPlaceUrl({
                    apiKey: config.tomTomApiKey,
                    entityId,
                });

                try {
                    const placeResponse = await fetchJson(placeUrl, config.requestTimeoutMs);
                    debugEntry.requests.push(
                        createDebugRequest({
                            step: `place:${entityId}`,
                            url: placeUrl,
                            status: placeResponse.status,
                            output: placeResponse.payload,
                        })
                    );

                    const placeResult = Array.isArray(placeResponse.payload?.results)
                        ? placeResponse.payload.results[0] || null
                        : placeResponse.payload;
                    const fuelPriceId = pickFirstDefined([
                        placeResult?.dataSources?.fuelPrice?.id,
                        placeResult?.poi?.fuelPrice?.id,
                        placeResult?.fuelPrice?.id,
                    ]);

                    if (!fuelPriceId) {
                        return null;
                    }

                    const fuelPriceUrl = buildTomTomFuelPriceUrl({
                        apiKey: config.tomTomApiKey,
                        fuelPriceId,
                    });

                    try {
                        const fuelPriceResponse = await fetchJson(fuelPriceUrl, config.requestTimeoutMs);
                        debugEntry.requests.push(
                            createDebugRequest({
                                step: `fuelPrice:${fuelPriceId}`,
                                url: fuelPriceUrl,
                                status: fuelPriceResponse.status,
                                output: fuelPriceResponse.payload,
                            })
                        );

                        return normalizeTomTomStationBundle({
                            origin: {
                                latitude,
                                longitude,
                            },
                            fuelType,
                            searchResult: stationResult,
                            placeResult,
                            fuelPriceResult: fuelPriceResponse.payload,
                        });
                    } catch (error) {
                        debugEntry.requests.push(
                            createDebugRequest({
                                step: `fuelPrice:${fuelPriceId}`,
                                url: fuelPriceUrl,
                                status: error?.status,
                                output: error?.payload || null,
                                error: error?.message || 'Fuel price request failed',
                            })
                        );
                        return null;
                    }
                } catch (error) {
                    debugEntry.requests.push(
                        createDebugRequest({
                            step: `place:${entityId}`,
                            url: placeUrl,
                            status: error?.status,
                            output: error?.payload || null,
                            error: error?.message || 'Place request failed',
                        })
                    );
                    return null;
                }
            })
        );

        const resolvedQuotes = quotes.filter(Boolean);
        const bestQuote = selectPreferredQuote(resolvedQuotes);

        debugEntry.summary.quoteCount = resolvedQuotes.length;
        debugEntry.quoteReturned = Boolean(bestQuote);

        if (!bestQuote) {
            debugEntry.error = 'No station returned a usable fuel price.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote: bestQuote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'categorySearch',
                url: searchUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'Category search request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchBarchartQuote({ latitude, longitude, zipCode, radiusMiles, fuelType, config }) {
    const debugEntry = createDebugEntry('barchart', 'station', Boolean(config.barchartApiKey));

    if (!config.barchartApiKey) {
        debugEntry.error = 'Barchart API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestUrl = buildBarchartUrl({
        apiKey: config.barchartApiKey,
        latitude,
        longitude,
        zipCode,
        radiusMiles,
        fuelType,
    });

    try {
        const response = await fetchJson(requestUrl, config.requestTimeoutMs);

        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat('barchart');

        const quotes = normalizeBarchartResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'getFuelPrices',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.summary.resultCount = Array.isArray(response.payload?.results) ? response.payload.results.length : 0;
        debugEntry.quoteReturned = Boolean(quotes && quotes.length > 0);

        if (!quotes || quotes.length === 0) {
            debugEntry.error = debugEntry.summary.resultCount === 0
                ? 'The search request returned no nearby stations.'
                : 'No station returned a usable fuel price.';
            debugEntry.failureCategory = debugEntry.summary.resultCount === 0 ? 'location' : 'price';
        }

        return { debugEntry, quotes };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'getFuelPrices',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'Barchart request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchGoogleQuote({ latitude, longitude, radiusMiles, fuelType, config }) {
    const debugEntry = createDebugEntry('google', 'station', Boolean(config.googleMapsApiKey));

    if (!config.googleMapsApiKey) {
        debugEntry.error = 'Google Maps API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestConfig = buildGoogleNearbySearchRequest({
        latitude,
        longitude,
        radiusMiles,
    });

    try {
        const response = await fetchJson(requestConfig.url, {
            body: requestConfig.body,
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': config.googleMapsApiKey,
                'X-Goog-FieldMask': requestConfig.fieldMask,
            },
            method: 'POST',
            timeoutMs: config.requestTimeoutMs,
        });

        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat('google');

        const quotes = normalizeGooglePlacesResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'searchNearby',
                url: requestConfig.url,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.summary.resultCount = Array.isArray(response.payload?.places) ? response.payload.places.length : 0;
        debugEntry.quoteReturned = Boolean(quotes && quotes.length > 0);

        if (!quotes || quotes.length === 0) {
            debugEntry.error = debugEntry.summary.resultCount === 0
                ? 'The search request returned no nearby stations.'
                : 'No station returned a usable fuel price.';
            debugEntry.failureCategory = debugEntry.summary.resultCount === 0 ? 'location' : 'price';
        }

        return { debugEntry, quotes };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'searchNearby',
                url: requestConfig.url,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'Google Places request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchCardogQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('cardog', 'area', Boolean(config.cardogApiKey));

    if (!config.cardogApiKey) {
        debugEntry.error = 'Cardog API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestUrl = buildCardogUrl({
        latitude,
        longitude,
        fuelType,
    });

    try {
        const response = await fetchJson(requestUrl, {
            headers: {
                'x-api-key': config.cardogApiKey,
            },
            timeoutMs: config.requestTimeoutMs,
        });
        const quote = normalizeCardogResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'gasPrices',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.quoteReturned = Boolean(quote);

        if (!quote) {
            debugEntry.error = 'No usable area price returned.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'gasPrices',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'Cardog request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchBlsQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('bls', 'area', true);
    const requestUrl = buildBlsUrl({ fuelType });

    try {
        const response = await fetchJson(requestUrl, config.requestTimeoutMs);
        const quote = normalizeBlsResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'timeseries',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.quoteReturned = Boolean(quote);

        if (!quote) {
            debugEntry.error = 'No usable area price returned.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'timeseries',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'BLS request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchEiaQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('eia', 'area', Boolean(config.eiaApiKey));

    if (!config.eiaApiKey) {
        debugEntry.error = 'EIA API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestUrl = buildEiaUrl({
        apiKey: config.eiaApiKey,
        fuelType,
    });

    try {
        const response = await fetchJson(requestUrl, config.requestTimeoutMs);
        const quote = normalizeEiaResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'data',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.quoteReturned = Boolean(quote);

        if (!quote) {
            debugEntry.error = 'No usable area price returned.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'data',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'EIA request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchFredQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('fred', 'area', Boolean(config.fredApiKey));

    if (!config.fredApiKey) {
        debugEntry.error = 'FRED API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestUrl = buildFredUrl({
        apiKey: config.fredApiKey,
        fuelType,
    });

    try {
        const response = await fetchJson(requestUrl, config.requestTimeoutMs);
        const quote = normalizeFredResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'observations',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.quoteReturned = Boolean(quote);

        if (!quote) {
            debugEntry.error = 'No usable area price returned.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'observations',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'FRED request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchGasBuddyQuote({ latitude, longitude, fuelType, config, forceLive = false }) {
    const debugEntry = createDebugEntry('gasbuddy', 'station', true);
    const origin = { latitude, longitude };
    const searchLat = Math.round(latitude * 10) / 10;
    const searchLng = Math.round(longitude * 10) / 10;

    try {
        const { supabase } = require('../../lib/supabase');

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { data, error } = forceLive
            ? { data: null, error: null }
            : await supabase
                .from('station_prices')
                .select('*')
                .eq('search_latitude_rounded', searchLat)
                .eq('search_longitude_rounded', searchLng)
                .eq('fuel_type', fuelType)
                .gte('created_at', oneHourAgo);

        if (!error && data && data.length > 0) {
            const { incrementApiStat } = require('../../lib/devCounter');
            incrementApiStat('supabase');
            const freshQuotes = buildLatestQuotesFromRows({
                rows: data,
                origin,
            });

            if (freshQuotes.length > 0) {
                const freshQuoteIds = new Set(
                    freshQuotes
                        .map(quote => buildQuoteIdentity(quote))
                        .filter(Boolean)
                );

                let fallbackAreaQuotes = [];

                const { data: areaRows, error: areaRowsError } = await supabase
                    .from('station_prices')
                    .select('*')
                    .eq('search_latitude_rounded', searchLat)
                    .eq('search_longitude_rounded', searchLng)
                    .eq('fuel_type', fuelType)
                    .order('created_at', { ascending: false });

                if (!areaRowsError && Array.isArray(areaRows) && areaRows.length > 0) {
                    const dedupedAreaQuotes = buildLatestQuotesFromRows({
                        rows: areaRows,
                        origin,
                        fallbackSourceLabel: 'GasBuddy (area cache)',
                    });

                    fallbackAreaQuotes = dedupedAreaQuotes.filter(quote => !freshQuoteIds.has(buildQuoteIdentity(quote)));
                }

                const quotes = [...freshQuotes, ...fallbackAreaQuotes];
                debugEntry.summary.resultCount = quotes.length;
                debugEntry.summary.freshCacheQuoteCount = freshQuotes.length;
                debugEntry.summary.areaCacheFallbackCount = fallbackAreaQuotes.length;
                debugEntry.quoteReturned = true;
                debugEntry.requests.push(
                    createDebugRequest({
                        step: 'supabase_cache',
                        url: 'supabase://station_prices',
                        status: 200,
                        output: `${quotes.length} cached prices retrieved (${freshQuotes.length} fresh + ${fallbackAreaQuotes.length} area fallback)`,
                    })
                );

                if (__DEV__) {
                    console.log(
                        `[FuelUp][GasBuddy] cache-return: fresh=${freshQuotes.length} areaFallback=${fallbackAreaQuotes.length} total=${quotes.length} search=${searchLat},${searchLng} fuel=${fuelType}`
                    );
                }

                return { debugEntry, quotes };
            }

            debugEntry.requests.push(
                createDebugRequest({
                    step: 'supabase_cache',
                    url: 'supabase://station_prices',
                    status: 200,
                    output: 'Cached rows found, but none had a usable price. Falling back to live fetch.',
                })
            );
        } else if (forceLive) {
            debugEntry.requests.push(
                createDebugRequest({
                    step: 'supabase_cache',
                    url: 'supabase://station_prices',
                    status: 200,
                    output: 'Cache bypassed (force live enabled).',
                })
            );
        }
    } catch (err) {
        console.error('Supabase caching check failed:', err);
    }

    const requestConfig = buildGasBuddyGraphQLRequest({
        latitude,
        longitude,
        fuelType,
    });

    try {
        const response = await fetchJson(requestConfig.url, {
            body: requestConfig.body,
            headers: requestConfig.headers,
            method: 'POST',
            timeoutMs: config.requestTimeoutMs,
        });

        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat('gasbuddy');

        const liveQuotes = normalizeGasBuddyResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        }) || [];

        let fallbackQuotes = [];

        try {
            const { supabase } = require('../../lib/supabase');
            const allStations = response.payload?.data?.locationBySearchTerm?.stations?.results || [];
            const returnedStationIds = new Set(
                allStations
                    .map(station => station?.id)
                    .filter(Boolean)
                    .map(stationId => String(stationId))
            );
            const liveQuoteStationIds = new Set(
                liveQuotes
                    .map(quote => (quote?.stationId ? String(quote.stationId) : ''))
                    .filter(Boolean)
            );

            const missingPriceStationIds = Array.from(returnedStationIds)
                .filter(stationId => !liveQuoteStationIds.has(stationId));

            debugEntry.summary.missingPriceStationCount = missingPriceStationIds.length;

            const { data: areaRows, error: areaRowsError } = await supabase
                .from('station_prices')
                .select('*')
                .eq('search_latitude_rounded', searchLat)
                .eq('search_longitude_rounded', searchLng)
                .eq('fuel_type', fuelType)
                .order('created_at', { ascending: false });

            if (!areaRowsError && Array.isArray(areaRows) && areaRows.length > 0) {
                const dedupedAreaQuotes = buildLatestQuotesFromRows({
                    rows: areaRows,
                    origin,
                    fallbackSourceLabel: 'GasBuddy (area cache)',
                });

                fallbackQuotes = dedupedAreaQuotes.filter(
                    quote => !liveQuoteStationIds.has(String(quote.stationId || ''))
                );

                debugEntry.summary.areaCacheStationCount = dedupedAreaQuotes.length;
                debugEntry.summary.apiOmittedStationFallbackCount = fallbackQuotes.filter(
                    quote => !returnedStationIds.has(String(quote.stationId || ''))
                ).length;
            }
        } catch (fallbackLookupError) {
            console.error('GasBuddy fallback lookup failed:', fallbackLookupError);
        }

        const quotes = [...liveQuotes, ...fallbackQuotes];

        debugEntry.requests.push(
            createDebugRequest({
                step: 'graphql',
                url: requestConfig.url,
                status: response.status,
                output: response.payload,
            })
        );
        const stationCount = response.payload?.data?.locationBySearchTerm?.stations?.results?.length || 0;
        debugEntry.summary.resultCount = stationCount;
        debugEntry.summary.liveQuoteCount = liveQuotes.length;
        debugEntry.summary.fallbackQuoteCount = fallbackQuotes.length;
        debugEntry.summary.totalQuoteCount = quotes.length;
        debugEntry.quoteReturned = Boolean(quotes && quotes.length > 0);

        if (__DEV__) {
            console.log(
                `[FuelUp][GasBuddy] live-return: apiStations=${stationCount} live=${liveQuotes.length} fallback=${fallbackQuotes.length} total=${quotes.length} missingPriceStations=${debugEntry.summary.missingPriceStationCount || 0} apiOmittedFallback=${debugEntry.summary.apiOmittedStationFallbackCount || 0}`
            );
        }

        if (!quotes || quotes.length === 0) {
            debugEntry.error = stationCount === 0
                ? 'The search request returned no nearby stations.'
                : 'No station returned a usable fuel price.';
            debugEntry.failureCategory = stationCount === 0 ? 'location' : 'price';
        } else {
            try {
                const { supabase } = require('../../lib/supabase');
                const { getUserUuid } = require('../../lib/user');
                const userUuid = await getUserUuid();

                const rows = liveQuotes.map(q => ({
                    station_id: q.stationId,
                    provider_id: q.providerId,
                    fuel_type: q.fuelType,
                    all_prices: q.allPrices || {},
                    price: q.price,
                    currency: q.currency,
                    station_name: String(q.stationName).substring(0, 255),
                    address: String(q.address).substring(0, 500),
                    latitude: q.latitude,
                    longitude: q.longitude,
                    user_uuid: userUuid,
                    search_latitude_rounded: searchLat,
                    search_longitude_rounded: searchLng,
                    source_label: q.sourceLabel,
                    rating: q.rating,
                    user_rating_count: q.userRatingCount,
                    updated_at_source: q.updatedAt
                }));

                if (rows.length > 0) {
                    const { error: insertError } = await supabase.from('station_prices').insert(rows);
                    if (insertError) {
                        debugEntry.summary.persistedLiveRowCount = 0;
                        debugEntry.summary.persistError = insertError?.message || 'Insert failed';
                        debugEntry.requests.push(
                            createDebugRequest({
                                step: 'supabase_write',
                                url: 'supabase://station_prices',
                                status: 500,
                                error: insertError?.message || 'Supabase cache insert failed',
                            })
                        );
                        console.error('Supabase cache insert failed:', insertError);
                    } else {
                        debugEntry.summary.persistedLiveRowCount = rows.length;
                        debugEntry.requests.push(
                            createDebugRequest({
                                step: 'supabase_write',
                                url: 'supabase://station_prices',
                                status: 201,
                                output: `${rows.length} live rows inserted`,
                            })
                        );
                    }
                } else {
                    debugEntry.summary.persistedLiveRowCount = 0;
                    debugEntry.requests.push(
                        createDebugRequest({
                            step: 'supabase_write',
                            url: 'supabase://station_prices',
                            status: 200,
                            output: 'No live-priced rows to persist.',
                        })
                    );
                }
            } catch (err) {
                debugEntry.summary.persistedLiveRowCount = 0;
                debugEntry.summary.persistError = err?.message || 'Supabase write failed';
                debugEntry.requests.push(
                    createDebugRequest({
                        step: 'supabase_write',
                        url: 'supabase://station_prices',
                        status: 500,
                        error: err?.message || 'Supabase write failed',
                    })
                );
                console.error('Supabase trend log error:', err);
            }
        }

        return { debugEntry, quotes };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'graphql',
                url: requestConfig.url,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'GasBuddy request failed',
            })
        );
        return { debugEntry, quotes: null };
    }
}

function normalizeSnapshot({ quote, topStations, regionalQuotes, cacheKey }) {
    return {
        cacheKey,
        quote,
        topStations,
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
        isFresh: isCacheEntryFresh(
            cacheEntry,
            cacheEntry.quote?.isEstimated ? getFuelServiceConfig().areaCacheTtlMs : getFuelServiceConfig().stationCacheTtlMs
        ),
    };
}

async function refreshFuelPriceSnapshot({ latitude, longitude, zipCode, radiusMiles, fuelType, preferredProvider, forceLiveGasBuddy = false }) {
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
        const debugState = {
            input: {
                fuelType: normalizedFuelType,
                latitude,
                longitude,
                radiusMiles: normalizedRadius,
                zipCode: zipCode || null,
            },
            providers: [],
            requestedAt: new Date().toISOString(),
        };

        const stationFetches = preferredProvider === 'gasbuddy'
            ? [
                fetchGasBuddyQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                    forceLive: forceLiveGasBuddy,
                }),
            ]
            : [
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
                fetchGoogleQuote({
                    latitude,
                    longitude,
                    radiusMiles: normalizedRadius,
                    fuelType: normalizedFuelType,
                    config,
                }),
            ];

        const areaFetches = preferredProvider === 'gasbuddy'
            ? []
            : [
                fetchCardogQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                }),
                fetchBlsQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                }),
                fetchEiaQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                }),
                fetchFredQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                }),
            ];

        const providerResults = await Promise.all([...stationFetches, ...areaFetches]);

        debugState.providers = providerResults.map(result => result.debugEntry);

        const allQuotes = providerResults.flatMap(result => result.quotes || result.quote || []).filter(Boolean);
        const stationQuotes = allQuotes.filter(quote => quote.providerTier === 'station' && !quote.isEstimated);

        const uniqueQuotesMap = new Map();
        stationQuotes.forEach(q => {
            const id = buildQuoteIdentity(q);

            if (!id) {
                return;
            }

            if (!uniqueQuotesMap.has(id) || q.price < uniqueQuotesMap.get(id).price) {
                uniqueQuotesMap.set(id, q);
            }
        });

        const topStations = Array.from(uniqueQuotesMap.values())
            .sort((a, b) => a.price - b.price || a.distanceMiles - b.distanceMiles);
        const dedupedStationCount = stationQuotes.length - uniqueQuotesMap.size;

        debugState.summary = {
            stationQuoteCount: stationQuotes.length,
            uniqueStationQuoteCount: uniqueQuotesMap.size,
            dedupedStationCount,
        };

        if (__DEV__ && dedupedStationCount > 0) {
            console.log(
                `[FuelUp][Aggregation] deduped ${dedupedStationCount} station quotes (input=${stationQuotes.length}, unique=${uniqueQuotesMap.size})`
            );
        }

        const bestQuote = selectPreferredQuote(allQuotes);
        const supplementalQuotes = allQuotes.filter(quote => quote.providerTier === 'area');

        if (!bestQuote) {
            const requestError = new Error('No fuel price providers returned usable data.');
            requestError.debugState = debugState;
            requestError.userMessage = getFuelFailureMessage({ debugState });
            throw requestError;
        }

        const snapshot = normalizeSnapshot({
            cacheKey,
            quote: bestQuote,
            topStations,
            regionalQuotes: supplementalQuotes,
        });

        await setCachedEntry(cacheKey, snapshot);

        return {
            debugState,
            snapshot,
        };
    })().finally(() => {
        inflightRequests.delete(cacheKey);
    });

    inflightRequests.set(cacheKey, request);

    return request;
}

async function clearFuelPriceCache() {
    inflightRequests.clear();
    return clearCachedEntries('fuel:');
}

module.exports = {
    clearFuelPriceCache,
    getFuelFailureMessage,
    getCachedFuelPriceSnapshot,
    refreshFuelPriceSnapshot,
};
