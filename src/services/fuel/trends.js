import { supabase } from '../../lib/supabase.js';
import { filterStationQuotesForHome } from '../../lib/homeState.js';
import { rankQuotesForFuelGrade } from '../../lib/fuelGrade.js';
import { buildFuelSearchRequestKey } from '../../lib/fuelSearchState.js';
const { buildLatestFuelStationQuotesFromRows } = require('./index');
const { buildValidationState } = require('./priceValidation');
const { applyCurrentStationQuoteProjection } = require('./trendProjection');
const { buildTrendLeaderboard } = require('./trendLeaderboard');

const cachedTrendDataByRequestKey = {};
const lastResolvedTrendDataByRequestKey = {};
const lastTrendsScreenViewedAtMsByRequestKey = {};
const inFlightTrendDataRequestsByRequestKey = {};
let trendCacheGeneration = 0;
const FUEL_GRADE_ALIASES = {
    regular: ['regular', 'regular_gas'],
    midgrade: ['midgrade', 'midgrade_gas'],
    premium: ['premium', 'premium_gas'],
    diesel: ['diesel'],
};

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

function toPositiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function resolveStoredFuelPrice(allPrices, fuelType) {
    if (!allPrices || typeof allPrices !== 'object') {
        return null;
    }

    const aliases = FUEL_GRADE_ALIASES[String(fuelType || 'regular').toLowerCase()] || [fuelType];

    for (const alias of aliases) {
        const directPrice = toPositiveNumber(allPrices[alias]);
        if (directPrice !== null) {
            return directPrice;
        }
    }

    const paymentMap = allPrices._payment && typeof allPrices._payment === 'object'
        ? allPrices._payment
        : {};

    for (const alias of aliases) {
        const paymentEntry = paymentMap[alias];

        if (!paymentEntry || typeof paymentEntry !== 'object') {
            continue;
        }

        const creditPrice = toPositiveNumber(paymentEntry.credit);
        if (creditPrice !== null) {
            return creditPrice;
        }

        const cashPrice = toPositiveNumber(paymentEntry.cash);
        if (cashPrice !== null) {
            return cashPrice;
        }
    }

    return null;
}

function buildValidatedTrendRows(rows, fuelType) {
    const normalizedFuelType = String(fuelType || 'regular').toLowerCase();
    const validationRows = (rows || [])
        .map(row => {
            const rowPrice = (
                resolveStoredFuelPrice(row.all_prices, normalizedFuelType) ??
                (String(row.fuel_type || '').toLowerCase() === normalizedFuelType ? toPositiveNumber(row.price) : null)
            );
            const timestampMs = Date.parse(row.created_at || '');

            if (rowPrice === null || !Number.isFinite(timestampMs)) {
                return null;
            }

            return {
                stationId: row.station_id ? String(row.station_id) : '',
                fuelType: normalizedFuelType,
                price: rowPrice,
                timestampMs,
                lat: Number(row.latitude),
                lon: Number(row.longitude),
                originalRow: row,
            };
        })
        .filter(Boolean);
    const validationState = buildValidationState(validationRows);

    return validationState.outputs.map(({ row, result }) => ({
        ...row.originalRow,
        timestampMs: row.timestampMs,
        price: result.finalDisplayedPrice,
        api_price: result.apiPrice,
        predicted_price: result.predictedPrice,
        used_prediction: result.usedPrediction,
        validation_decision: result.decision,
        risk: result.risk,
        validity: result.validity,
    }));
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
    preferredProvider = 'primary',
    minimumRating = 0,
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
    });
}

export async function fetchTrendData({
    latitude,
    longitude,
    fuelType = 'regular',
    radiusMiles = 10,
    minimumRating = 0,
}) {
    const searchLat = Math.round(latitude * 10) / 10;
    const searchLng = Math.round(longitude * 10) / 10;

    const { data: rows, error } = await supabase
        .from('station_prices')
        .select('*')
        .eq('search_latitude_rounded', searchLat)
        .eq('search_longitude_rounded', searchLng)
        .eq('fuel_type', fuelType)
        .order('created_at', { ascending: true });

    const validatedRows = !error && Array.isArray(rows)
        ? buildValidatedTrendRows(rows, fuelType)
        : [];
    const projectedLatestQuotes = validatedRows.length > 0
        ? buildLatestFuelStationQuotesFromRows({
            rows,
            origin: {
                latitude,
                longitude,
            },
        })
        : [];
    const rankedLatestQuotes = rankQuotesForFuelGrade(
        filterStationQuotesForHome({
            quotes: projectedLatestQuotes,
            origin: {
                latitude,
                longitude,
            },
            radiusMiles,
            minimumRating,
        }),
        fuelType
    );
    const visibleStationIds = new Set(
        rankedLatestQuotes
            .map(quote => String(quote?.stationId || '').trim())
            .filter(Boolean)
    );
    const projectedRows = applyCurrentStationQuoteProjection(validatedRows, projectedLatestQuotes);
    const displayedRows = visibleStationIds.size > 0
        ? projectedRows.filter(row => visibleStationIds.has(String(row?.station_id || '').trim()))
        : [];

    if (error || displayedRows.length === 0 || rankedLatestQuotes.length === 0) {
        return {
            overallTrend: null,
            averagePricesByDay: [],
            stationsWithLargestDelta: [],
            leaderboard: [],
            leaderboardLastChangedAt: null,
            competitorClusters: [],
            mapHeatmapPoints: [],
        };
    }

    // Tracks when the visible top-5 leaderboard snapshot last changed.
    let leaderboardLastChangedAt = null;
    const latestPriceByStation = new Map();
    let previousLeaderboardSnapshotKey = null;

    displayedRows.forEach(row => {
        latestPriceByStation.set(row.station_id, row.price);

        const rankingSnapshot = [...latestPriceByStation.entries()]
            .sort((a, b) => {
                if (a[1] === b[1]) return String(a[0]).localeCompare(String(b[0]));
                return a[1] - b[1];
            })
            .slice(0, 5)
            .map(([stationId, price], index) => `${index + 1}:${stationId}:${Number(price).toFixed(3)}`)
            .join('|');

        if (rankingSnapshot !== previousLeaderboardSnapshotKey) {
            previousLeaderboardSnapshotKey = rankingSnapshot;
            leaderboardLastChangedAt = row.created_at;
        }
    });

    // 1. Average prices grouped by day (for the main chart)
    const dayAggregation = {};
    displayedRows.forEach(row => {
        const dateStr = new Date(row.created_at).toISOString().split('T')[0];
        if (!dayAggregation[dateStr]) {
            dayAggregation[dateStr] = { sum: 0, count: 0 };
        }
        dayAggregation[dateStr].sum += row.price;
        dayAggregation[dateStr].count += 1;
    });

    const averagePricesByDay = Object.keys(dayAggregation).sort().map(date => {
        return {
            date,
            price: dayAggregation[date].sum / dayAggregation[date].count
        };
    });

    // Determine overall area trend
    let overallTrend = null;
    if (averagePricesByDay.length >= 2) {
        const firstPrice = averagePricesByDay[0].price;
        const lastPrice = averagePricesByDay[averagePricesByDay.length - 1].price;
        const delta = lastPrice - firstPrice;
        overallTrend = {
            delta,
            isIncrease: delta > 0,
            isDecrease: delta < 0
        };
    }

    // 2. Stations with the largest delta and grouping for competition
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
        stationHistoryById,
        limit: 5,
    });

    // 3. Competitor Clusters (Stations within 0.5 miles of each other)
    const processedPairs = new Set();
    const competitorClusters = [];

    for (let i = 0; i < stations.length; i++) {
        for (let j = i + 1; j < stations.length; j++) {
            const st1 = stations[i];
            const st2 = stations[j];
            const pairKey = `${st1.stationId}-${st2.stationId}`;

            if (processedPairs.has(pairKey)) continue;
            processedPairs.add(pairKey);

            const distance = getDistanceMiles(st1.latitude, st1.longitude, st2.latitude, st2.longitude);
            if (distance <= 0.5) { // Same block / very close
                // Check if they update frequently
                const combinedUpdates = st1.updatesCount + st2.updatesCount;
                if (combinedUpdates > 0) {
                    // Calculate typical schedule / amount
                    const allJumps = [...st1.priceJumps, ...st2.priceJumps];
                    const avgJumpAmount = allJumps.length > 0
                        ? allJumps.reduce((acc, jump) => acc + Math.abs(jump.amount), 0) / allJumps.length
                        : 0;

                    competitorClusters.push({
                        stations: [st1, st2],
                        distanceMiles: distance,
                        totalUpdates: combinedUpdates,
                        averageJumpAmount: avgJumpAmount,
                        updateFrequencyDesc: combinedUpdates > 5 ? 'High frequency' : 'Moderate frequency'
                    });
                }
            }
        }
    }

    // Sort clusters by most competitive
    competitorClusters.sort((a, b) => b.totalUpdates - a.totalUpdates);

    return {
        overallTrend,
        averagePricesByDay,
        leaderboard,
        leaderboardLastChangedAt,
        competitorClusters: competitorClusters.slice(0, 5), // Top 5 competitive blocks
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
    preferredProvider = 'primary',
    minimumRating = 0,
    requestKey = '',
}) {
    const resolvedRequestKey = buildTrendRequestKey({
        latitude,
        longitude,
        fuelType,
        radiusMiles,
        preferredProvider,
        minimumRating,
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
