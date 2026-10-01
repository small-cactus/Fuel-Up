import { rankStationQuotes } from '../../lib/stationPreferences.js';
import { supabase } from '../../lib/supabase.js';
import { buildVisibleStations } from '../../lib/visibleStations.js';
import { buildFuelSearchRequestKey } from '../../lib/fuelSearchState.js';
const { refreshFuelPriceSnapshot, getCachedFuelPriceSnapshot } = require('./index');
const { buildRawTrendRows } = require('./rawTrendRows');
const { buildAveragePriceTrendSeries } = require('./trendAggregation');
const { buildTrendLeaderboard } = require('./trendLeaderboard');

const cachedTrendDataByRequestKey = {};
const lastResolvedTrendDataByRequestKey = {};
const lastTrendsScreenViewedAtMsByRequestKey = {};
const inFlightTrendDataRequestsByRequestKey = {};
let trendCacheGeneration = 0;
const TREND_HISTORY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const TREND_HISTORY_MAX_ROWS = 1500;
// Helper: Calculate distance between two coords in miles
function getDistanceMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of the earth in miles
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function clearObjectValues(target, requestKey = null) {
    if (requestKey) {
        delete target[requestKey];
        return;
    }

    Object.keys(target).forEach(key => {
        delete target[key];
    });
}

export function captureTrendCacheGeneration() {
    return trendCacheGeneration;
}

export function isTrendCacheGenerationCurrent(generation) {
    return generation === trendCacheGeneration;
}

export function clearTrendDataCache(fuelType = null) {
    trendCacheGeneration += 1;
    clearObjectValues(cachedTrendDataByRequestKey, fuelType);
    clearObjectValues(lastResolvedTrendDataByRequestKey, fuelType);
    clearObjectValues(lastTrendsScreenViewedAtMsByRequestKey, fuelType);
    clearObjectValues(inFlightTrendDataRequestsByRequestKey, fuelType);
}

export function buildTrendRequestKey({
    latitude,
    longitude,
    fuelType = 'regular',
    radiusMiles = 10,
    preferredProvider = 'gasbuddy',
    minimumRating = 0,
    preferredBrands = [],
    fuelMemberships = [],
    requiresE85 = false,
    requestKey = '',
}) {
    if (requestKey) {
        return String(requestKey);
    }

    return buildFuelSearchRequestKey({
        origin: {
            latitude,
            longitude,
        },
        fuelGrade: fuelType,
        radiusMiles,
        preferredProvider,
        minimumRating,
        preferredBrands,
        fuelMemberships,
        requiresE85,
    });
}

export async function fetchTrendData({
    latitude,
    longitude,
    fuelType = 'regular',
    radiusMiles = 10,
    minimumRating = 0,
    preferredBrands = [],
    fuelMemberships = [],
    requiresE85 = false,
}) {
    const searchLat = Math.round(latitude * 10) / 10;
    const searchLng = Math.round(longitude * 10) / 10;
    const lookbackStartIso = new Date(Date.now() - TREND_HISTORY_LOOKBACK_MS).toISOString();

    const query = { latitude, longitude, radiusMiles, fuelType, requiresE85 };
    // Home has just loaded this exact area. Reuse that snapshot instead of
    // independently selecting from a second response on a tab switch.
    const latestSnapshot = async () => {
        const cached = await getCachedFuelPriceSnapshot(query);
        const age = Date.now() - Date.parse(cached?.fetchedAt);
        if (cached && age >= 0 && age < 5 * 60000) return cached;
        return (await refreshFuelPriceSnapshot(query)).snapshot;
    };
    const [history, snapshot] = await Promise.all([supabase
        .from('station_prices')
        .select('*')
        .eq('search_latitude_rounded', searchLat)
        .eq('search_longitude_rounded', searchLng)
        .eq('fuel_type', fuelType)
        .gte('created_at', lookbackStartIso)
        .order('created_at', { ascending: false })
        .limit(TREND_HISTORY_MAX_ROWS),
        latestSnapshot(),
    ]);
    const { data: descendingRows, error } = history;

    const rows = Array.isArray(descendingRows) ? descendingRows.slice().reverse() : descendingRows;

    const rawRows = !error && Array.isArray(rows) ? buildRawTrendRows(rows, fuelType) : [];
    const rankedLatestQuotes = buildVisibleStations(snapshot, {
        origin: { latitude, longitude }, radiusMiles, minimumRating, fuelGrade: fuelType, requiresE85, preferredBrands, fuelMemberships,
    }).filter(quote => Number.isFinite(quote.price) && quote.price > 0);
    const visibleStationIds = new Set(
        rankedLatestQuotes
            .map(quote => String(quote?.stationId || '').trim())
            .filter(Boolean)
    );
    const displayedRows = visibleStationIds.size > 0
        ? rawRows.filter(row => visibleStationIds.has(String(row?.station_id || '').trim()))
        : [];

    if (rankedLatestQuotes.length === 0) {
        return {
            overallTrend: null,
            averagePricesByDay: [],
            stationsWithLargestDelta: [],
            leaderboard: [],
            leaderboardLatestReportedAt: null,
            mapHeatmapPoints: [],
        };
    }

    const leaderboardLatestReportedAt = new Date(Math.max(...rankedLatestQuotes.slice(0, 5)
        .map(quote => Date.parse(quote.updatedAt)))).toISOString();

    // A live raw average gives a new area a real starting point before local
    // history exists. Only the chart display carries this known value forward.
    const latestObservedAverage = {
        date: Number.isFinite(Date.parse(snapshot?.fetchedAt)) ? snapshot.fetchedAt : new Date().toISOString(),
        price: rankedLatestQuotes.reduce((sum, quote) => sum + quote.price, 0) / rankedLatestQuotes.length,
    };
    // Only occupied observation buckets. No estimates or synthetic history.
    const averagePricesByDay = buildAveragePriceTrendSeries(displayedRows);
    const hasHistoricalTrendSeries = averagePricesByDay.length >= 2;
    const trendSeriesMode = averagePricesByDay.length ? 'historical' : 'empty';

    // Determine overall area trend
    let overallTrend = null;
    if (hasHistoricalTrendSeries && averagePricesByDay.length >= 2) {
        const firstPrice = averagePricesByDay[0].price;
        const lastPrice = averagePricesByDay[averagePricesByDay.length - 1].price;
        const delta = lastPrice - firstPrice;
        overallTrend = {
            delta,
            isIncrease: delta > 0,
            isDecrease: delta < 0
        };
    }

    // Observed per-station history for comparison.
    const stationAggregation = {};
    // For heatmap, average price of each station over its history
    const mapHeatmapPoints = [];

    displayedRows.forEach(row => {
        if (!stationAggregation[row.station_id]) {
            stationAggregation[row.station_id] = {
                stationId: row.station_id,
                name: row.station_name,
                address: row.address,
                latitude: row.latitude,
                longitude: row.longitude,
                prices: [],
                updatesCount: 0,
                priceJumps: [],
            };
        }
        const st = stationAggregation[row.station_id];

        // Check if price changed from last known price
        const lastKnownPrice = st.prices.length > 0 ? st.prices[st.prices.length - 1].price : null;
        if (lastKnownPrice !== null && lastKnownPrice !== row.price) {
            st.updatesCount += 1;
            st.priceJumps.push({
                date: row.created_at,
                amount: row.price - lastKnownPrice
            });
        }

        // Only push unique consecutive prices so we don't end up with math against duplicates
        if (lastKnownPrice !== row.price) {
            st.prices.push({
                date: row.created_at,
                price: row.price
            });
        }
    });

    const stations = Object.values(stationAggregation);
    const stationHistoryById = new Map(
        stations.map(station => [String(station.stationId || '').trim(), station])
    );

    // Calculate max delta per station and distance to user
    stations.forEach(st => {
        const pricesOnly = st.prices.map(p => p.price);
        st.minPrice = Math.min(...pricesOnly);
        st.maxPrice = Math.max(...pricesOnly);
        st.delta = st.maxPrice - st.minPrice;
        st.distanceMiles = getDistanceMiles(latitude, longitude, st.latitude, st.longitude);

        const avgPrice = pricesOnly.reduce((a, b) => a + b, 0) / pricesOnly.length;
        mapHeatmapPoints.push({
            latitude: st.latitude,
            longitude: st.longitude,
            weight: avgPrice, // We can use average price as weight for heatmap
            stationId: st.stationId,
            averagePrice: avgPrice
        });
    });

    // Leaderboard logic instead of max delta
    // 1. Get earliest known price and latest known price for each station
    // 2. Rank stations based on earliest price
    // 3. Rank stations based on latest price
    // 4. Calculate rank delta
    stations.forEach(st => {
        const prices = st.prices;
        if (prices.length > 0) {
            st.earliestPrice = prices[0].price;
            st.latestPrice = prices[prices.length - 1].price;
        } else {
            st.earliestPrice = Infinity;
            st.latestPrice = Infinity;
        }
    });

    const earliestRanking = [...stations].sort((a, b) => {
        if (a.earliestPrice === b.earliestPrice) return String(a.stationId).localeCompare(String(b.stationId));
        return a.earliestPrice - b.earliestPrice;
    });

    // Assign earliest rank
    earliestRanking.forEach((st, idx) => {
        st.earliestRank = idx;
    });

    const leaderboard = buildTrendLeaderboard({
        rankedLatestQuotes,
        earliestRankedQuotes: rankStationQuotes(rankedLatestQuotes.filter(quote => stationHistoryById.has(String(quote.stationId))).map(quote => ({
            ...quote, price: stationHistoryById.get(String(quote.stationId)).earliestPrice,
        })), { preferredBrands }),
        stationHistoryById,
        limit: 5,
    });

    return {
        overallTrend,
        averagePricesByDay,
        trendSeriesMode,
        latestObservedAverage,
        leaderboard,
        leaderboardLatestReportedAt,
        mapHeatmapPoints
    };
}

export function getCachedTrendData(requestKey = '') {
    return cachedTrendDataByRequestKey[requestKey] || null;
}

export function setCachedTrendData(requestKey = '', data = null) {
    if (!requestKey) {
        return;
    }

    cachedTrendDataByRequestKey[requestKey] = data;
}

export function getLastResolvedTrendData(requestKey = '') {
    return lastResolvedTrendDataByRequestKey[requestKey] || null;
}

export function setLastResolvedTrendData(requestKey = '', data = null) {
    if (!requestKey) {
        return;
    }

    lastResolvedTrendDataByRequestKey[requestKey] = data;
}

export function getLastTrendsScreenViewedAt(requestKey = '') {
    return lastTrendsScreenViewedAtMsByRequestKey[requestKey] || 0;
}

export function setLastTrendsScreenViewedAt(requestKey = '', viewedAtMs = 0) {
    if (!requestKey) {
        return;
    }

    lastTrendsScreenViewedAtMsByRequestKey[requestKey] = viewedAtMs;
}

export function getInFlightTrendDataRequest(requestKey = '') {
    return inFlightTrendDataRequestsByRequestKey[requestKey] || null;
}

export async function prefetchTrendData({
    latitude,
    longitude,
    fuelType = 'regular',
    radiusMiles = 10,
    preferredProvider = 'gasbuddy',
    minimumRating = 0,
    preferredBrands = [],
    fuelMemberships = [],
    requiresE85 = false,
    requestKey = '',
}) {
    const resolvedRequestKey = buildTrendRequestKey({
        latitude,
        longitude,
        fuelType,
        radiusMiles,
        preferredProvider,
        minimumRating,
        preferredBrands,
        fuelMemberships,
        requiresE85,
        requestKey,
    });

    if (inFlightTrendDataRequestsByRequestKey[resolvedRequestKey]) {
        return inFlightTrendDataRequestsByRequestKey[resolvedRequestKey];
    }

    const requestGeneration = captureTrendCacheGeneration();
    let request;

    request = (async () => {
        try {
            const data = await fetchTrendData({
                latitude,
                longitude,
                fuelType,
                radiusMiles,
                minimumRating,
                preferredBrands,
                fuelMemberships,
                requiresE85,
            });
            if (!isTrendCacheGenerationCurrent(requestGeneration)) {
                return null;
            }
            setCachedTrendData(resolvedRequestKey, data);
            setLastResolvedTrendData(resolvedRequestKey, data);
            setLastTrendsScreenViewedAt(resolvedRequestKey, Date.now());
            return data;
        } finally {
            if (inFlightTrendDataRequestsByRequestKey[resolvedRequestKey] === request) {
                delete inFlightTrendDataRequestsByRequestKey[resolvedRequestKey];
            }
        }
    })();

    inFlightTrendDataRequestsByRequestKey[resolvedRequestKey] = request;
    return request;
}
