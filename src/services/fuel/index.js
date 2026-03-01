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

async function fetchGasBuddyQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('gasbuddy', 'station', true);

    try {
        const { supabase } = require('../../lib/supabase');

        const searchLat = Math.round(latitude * 10) / 10;
        const searchLng = Math.round(longitude * 10) / 10;
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('station_prices')
            .select('*')
            .eq('search_latitude_rounded', searchLat)
            .eq('search_longitude_rounded', searchLng)
            .eq('fuel_type', fuelType)
            .gte('created_at', oneHourAgo);

        if (!error && data && data.length > 0) {
            const { incrementApiStat } = require('../../lib/devCounter');
            incrementApiStat('supabase');
            const quotes = data.map(row => {
                const origin = { latitude, longitude };
                const distanceMiles = calculateDistanceMiles(origin, { latitude: row.latitude, longitude: row.longitude });
                return {
                    providerId: row.provider_id,
                    providerTier: 'station',
                    stationId: row.station_id,
                    stationName: row.station_name,
                    address: row.address,
                    latitude: row.latitude,
                    longitude: row.longitude,
                    fuelType: row.fuel_type,
                    price: row.price ? Number(row.price) : null,
                    allPrices: row.all_prices || { [row.fuel_type]: Number(row.price) },
                    currency: row.currency,
                    priceUnit: 'gallon',
                    distanceMiles,
                    fetchedAt: new Date().toISOString(),
                    updatedAt: row.updated_at_source || null,
                    isEstimated: false,
                    sourceLabel: row.source_label || PROVIDER_LABELS.gasbuddy,
                    rating: row.rating ? Number(row.rating) : null,
                    userRatingCount: row.user_rating_count ? Number(row.user_rating_count) : null,
                };
            });

            debugEntry.summary.resultCount = quotes.length;
            debugEntry.quoteReturned = true;
            debugEntry.requests.push(
                createDebugRequest({
                    step: 'supabase_cache',
                    url: 'supabase://station_prices',
                    status: 200,
                    output: `${quotes.length} cached prices retrieved`,
                })
            );
            return { debugEntry, quotes };
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

        const quotes = normalizeGasBuddyResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

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
        debugEntry.quoteReturned = Boolean(quotes && quotes.length > 0);

        if (!quotes || quotes.length === 0) {
            debugEntry.error = stationCount === 0
                ? 'The search request returned no nearby stations.'
                : 'No station returned a usable fuel price.';
            debugEntry.failureCategory = stationCount === 0 ? 'location' : 'price';
        } else {
            (async () => {
                try {
                    const { supabase } = require('../../lib/supabase');
                    const { getUserUuid } = require('../../lib/user');
                    const userUuid = await getUserUuid();
                    const searchLat = Math.round(latitude * 10) / 10;
                    const searchLng = Math.round(longitude * 10) / 10;

                    const rows = quotes.map(q => ({
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

                    const { error: insertError } = await supabase.from('station_prices').insert(rows);
                    if (insertError) {
                        console.error('Supabase cache insert failed:', insertError);
                    }
                } catch (err) {
                    console.error('Supabase async trend log error:', err);
                }
            })();
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

async function refreshFuelPriceSnapshot({ latitude, longitude, zipCode, radiusMiles, fuelType, preferredProvider }) {
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
            const id = q.providerId === 'google' ? q.stationId : `${q.latitude.toFixed(3)},${q.longitude.toFixed(3)}`;
            if (!uniqueQuotesMap.has(id) || q.price < uniqueQuotesMap.get(id).price) {
                uniqueQuotesMap.set(id, q);
            }
        });

        const topStations = Array.from(uniqueQuotesMap.values())
            .sort((a, b) => a.price - b.price || a.distanceMiles - b.distanceMiles);

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
