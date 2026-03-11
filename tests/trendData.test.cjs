const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
function buildStationHistoryRow({
    stationId,
    price,
    hoursAgo,
    latitude,
    longitude,
    sourceHoursAgo = hoursAgo,
}) {
    return {
        station_id: stationId,
        provider_id: 'gasbuddy',
        fuel_type: 'regular',
        all_prices: {
            regular: price,
        },
        price,
        currency: 'USD',
        station_name: stationId === 'A' ? 'Dodge Store' : `Station ${stationId}`,
        address: `${stationId} Main St`,
        latitude,
        longitude,
        search_latitude_rounded: 37.3,
        search_longitude_rounded: -122.0,
        source_label: 'GasBuddy',
        rating: 4.2,
        user_rating_count: 12,
        created_at: new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString(),
        updated_at_source: new Date(Date.now() - (sourceHoursAgo * 60 * 60 * 1000)).toISOString(),
    };
}

function primeModule(modulePath, exports) {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports,
    };
}

function buildStationHistoryById(rows, origin) {
    const earthRadiusMiles = 3958.7613;
    const degreesToRadians = value => value * (Math.PI / 180);
    const calculateDistanceMiles = (destination) => {
        const deltaLatitude = degreesToRadians(Number(destination.latitude) - Number(origin.latitude));
        const deltaLongitude = degreesToRadians(Number(destination.longitude) - Number(origin.longitude));
        const originLatitudeRadians = degreesToRadians(Number(origin.latitude));
        const destinationLatitudeRadians = degreesToRadians(Number(destination.latitude));
        const a = (
            Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
            Math.cos(originLatitudeRadians) *
            Math.cos(destinationLatitudeRadians) *
            Math.sin(deltaLongitude / 2) *
            Math.sin(deltaLongitude / 2)
        );
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return earthRadiusMiles * c;
    };
    const historyById = new Map();

    rows.forEach(row => {
        const stationId = String(row.station_id || '').trim();
        if (!stationId) {
            return;
        }

        const existing = historyById.get(stationId);
        const price = Number(row.price);
        const nextHistory = existing || {
            stationId,
            name: row.station_name,
            address: row.address,
            latitude: row.latitude,
            longitude: row.longitude,
            earliestPrice: price,
            distanceMiles: calculateDistanceMiles(row),
        };

        nextHistory.earliestPrice = Math.min(Number(nextHistory.earliestPrice), price);
        historyById.set(stationId, nextHistory);
    });

    return historyById;
}

test('trend projection upgrades the latest displayed station row to the current validated quote', async () => {
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const indexPath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const userPath = require.resolve('../src/lib/user.js');
    const trendProjectionPath = require.resolve('../src/services/fuel/trendProjection.js');
    const rows = [
        buildStationHistoryRow({ stationId: 'A', price: 3.25, hoursAgo: 120, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.00, hoursAgo: 120, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.01, hoursAgo: 120, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.02, hoursAgo: 120, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.35, hoursAgo: 96, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.10, hoursAgo: 96, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.11, hoursAgo: 96, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.12, hoursAgo: 96, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.45, hoursAgo: 72, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.20, hoursAgo: 72, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.21, hoursAgo: 72, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.22, hoursAgo: 72, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.55, hoursAgo: 60, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.30, hoursAgo: 60, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.31, hoursAgo: 60, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.32, hoursAgo: 60, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.65, hoursAgo: 48, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.40, hoursAgo: 48, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.41, hoursAgo: 48, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.42, hoursAgo: 48, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.69, hoursAgo: 2, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.70, hoursAgo: 2, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.71, hoursAgo: 1, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.10, hoursAgo: 0, latitude: 37.3346, longitude: -122.0090, sourceHoursAgo: 48 }),
    ];

    delete require.cache[supabasePath];
    delete require.cache[indexPath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[userPath];
    delete require.cache[trendProjectionPath];

    primeModule(asyncStoragePath, {
        default: {
            async getItem() { return null; },
            async setItem() { },
            async removeItem() { },
            async getAllKeys() { return []; },
            async multiRemove() { },
        },
    });
    primeModule(devCounterPath, {
        incrementApiStat: () => { },
        getApiStats: async () => ({}),
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: null,
    });

    try {
        const { buildLatestFuelStationQuotesFromRows } = require(indexPath);
        const { applyCurrentStationQuoteProjection } = require(trendProjectionPath);
        const validatedRows = rows.map(row => ({
            ...row,
            timestampMs: Date.parse(row.created_at),
            api_price: row.price,
            predicted_price: row.price,
            used_prediction: false,
            validation_decision: 'accept',
            risk: 0,
            validity: 1,
        }));
        const projectedLatestQuotes = buildLatestFuelStationQuotesFromRows({
            rows,
            origin: {
                latitude: 37.3346,
                longitude: -122.0090,
            },
        });
        const projectedRows = applyCurrentStationQuoteProjection(validatedRows, projectedLatestQuotes);
        const dodgeStoreRows = projectedRows.filter(row => row.station_id === 'A');
        const latestDodgeStoreRow = dodgeStoreRows[dodgeStoreRows.length - 1];

        assert.ok(projectedLatestQuotes.find(quote => quote.stationId === 'A')?.price > 3.10);
        assert.ok(latestDodgeStoreRow);
        assert.ok(
            latestDodgeStoreRow.price > 3.10,
            `expected projected latest price to be corrected, got ${latestDodgeStoreRow.price}`
        );
    } finally {
        delete require.cache[supabasePath];
        delete require.cache[indexPath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[userPath];
        delete require.cache[trendProjectionPath];
    }
});

test('trend leaderboard prices stay identical to the Home ranking pipeline for the same location and filters', async () => {
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const indexPath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const userPath = require.resolve('../src/lib/user.js');
    const trendProjectionPath = require.resolve('../src/services/fuel/trendProjection.js');
    const trendLeaderboardPath = require.resolve('../src/services/fuel/trendLeaderboard.js');
    const origin = { latitude: 37.3346, longitude: -122.0090 };
    const radiusMiles = 10;
    const minimumRating = 0;
    const fuelType = 'regular';
    const rows = [
        buildStationHistoryRow({ stationId: 'A', price: 3.25, hoursAgo: 120, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.00, hoursAgo: 120, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.01, hoursAgo: 120, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.02, hoursAgo: 120, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.35, hoursAgo: 96, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.10, hoursAgo: 96, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.11, hoursAgo: 96, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.12, hoursAgo: 96, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.45, hoursAgo: 72, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.20, hoursAgo: 72, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.21, hoursAgo: 72, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.22, hoursAgo: 72, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.55, hoursAgo: 60, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.30, hoursAgo: 60, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.31, hoursAgo: 60, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.32, hoursAgo: 60, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.65, hoursAgo: 48, latitude: 37.3346, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.40, hoursAgo: 48, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.41, hoursAgo: 48, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.42, hoursAgo: 48, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'B', price: 3.69, hoursAgo: 2, latitude: 37.3446, longitude: -122.0090 }),
        buildStationHistoryRow({ stationId: 'C', price: 3.70, hoursAgo: 2, latitude: 37.3496, longitude: -122.0150 }),
        buildStationHistoryRow({ stationId: 'D', price: 3.71, hoursAgo: 1, latitude: 37.3526, longitude: -122.0070 }),
        buildStationHistoryRow({ stationId: 'A', price: 3.10, hoursAgo: 0, latitude: 37.3346, longitude: -122.0090, sourceHoursAgo: 48 }),
    ];

    delete require.cache[supabasePath];
    delete require.cache[indexPath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[userPath];
    delete require.cache[trendProjectionPath];
    delete require.cache[trendLeaderboardPath];

    primeModule(asyncStoragePath, {
        default: {
            async getItem() { return null; },
            async setItem() { },
            async removeItem() { },
            async getAllKeys() { return []; },
            async multiRemove() { },
        },
    });
    primeModule(devCounterPath, {
        incrementApiStat: () => { },
        getApiStats: async () => ({}),
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: null,
    });

    try {
        const { filterStationQuotesForHome } = await import(pathToFileURL(path.resolve('/Users/anthonyh/Desktop/Fuel Up/src/lib/homeState.js')).href);
        const { rankQuotesForFuelGrade } = await import(pathToFileURL(path.resolve('/Users/anthonyh/Desktop/Fuel Up/src/lib/fuelGrade.js')).href);
        const { buildLatestFuelStationQuotesFromRows } = require(indexPath);
        const { applyCurrentStationQuoteProjection } = require(trendProjectionPath);
        const { buildTrendLeaderboard } = require(trendLeaderboardPath);
        const latestQuotes = buildLatestFuelStationQuotesFromRows({
            rows,
            origin,
        });
        const homeRankedQuotes = rankQuotesForFuelGrade(
            filterStationQuotesForHome({
                quotes: latestQuotes,
                origin,
                radiusMiles,
                minimumRating,
            }),
            fuelType
        );
        const projectedRows = applyCurrentStationQuoteProjection(
            rows.map(row => ({
                ...row,
                timestampMs: Date.parse(row.created_at),
                api_price: row.price,
                predicted_price: row.price,
                used_prediction: false,
                validation_decision: 'accept',
                risk: 0,
                validity: 1,
            })),
            latestQuotes
        );
        const displayedRows = projectedRows.filter(row => (
            homeRankedQuotes.some(quote => String(quote.stationId || '') === String(row.station_id || ''))
        ));
        const leaderboard = buildTrendLeaderboard({
            rankedLatestQuotes: homeRankedQuotes,
            stationHistoryById: buildStationHistoryById(displayedRows, origin),
            limit: 5,
        });

        assert.ok(leaderboard.length > 0);
        assert.equal(leaderboard.length, Math.min(5, homeRankedQuotes.length));
        leaderboard.forEach((station, index) => {
            assert.equal(station.stationId, homeRankedQuotes[index].stationId);
            assert.equal(station.latestPrice, homeRankedQuotes[index].price);
        });
    } finally {
        delete require.cache[supabasePath];
        delete require.cache[indexPath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[userPath];
        delete require.cache[trendProjectionPath];
        delete require.cache[trendLeaderboardPath];
    }
});

test('buildLatestFuelStationQuotesFromRows keeps uniform multi-grade rows as regular-only for regular queries', async () => {
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const indexPath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const userPath = require.resolve('../src/lib/user.js');

    delete require.cache[supabasePath];
    delete require.cache[indexPath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[userPath];

    primeModule(asyncStoragePath, {
        default: {
            async getItem() { return null; },
            async setItem() { },
            async removeItem() { },
            async getAllKeys() { return []; },
            async multiRemove() { },
        },
    });
    primeModule(devCounterPath, {
        incrementApiStat: () => { },
        getApiStats: async () => ({}),
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: null,
    });

    try {
        const { buildLatestFuelStationQuotesFromRows } = require(indexPath);
        const rows = [{
            station_id: 'uniform-regular',
            provider_id: 'gasbuddy',
            fuel_type: 'regular',
            all_prices: {
                regular: 3.39,
                midgrade: 3.39,
                premium: 3.39,
                diesel: 3.39,
            },
            price: 3.39,
            currency: 'USD',
            station_name: 'Uniform Fuel',
            address: '1 Main St',
            latitude: 37.3346,
            longitude: -122.0090,
            search_latitude_rounded: 37.3,
            search_longitude_rounded: -122.0,
            source_label: 'GasBuddy',
            created_at: new Date().toISOString(),
            updated_at_source: new Date().toISOString(),
        }];
        const quotes = buildLatestFuelStationQuotesFromRows({
            rows,
            origin: {
                latitude: 37.3346,
                longitude: -122.0090,
            },
        });

        assert.equal(quotes.length, 1);
        assert.deepEqual(quotes[0].allPrices, { regular: 3.39 });
        assert.deepEqual(quotes[0].availableFuelGrades, ['regular']);
    } finally {
        delete require.cache[supabasePath];
        delete require.cache[indexPath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[userPath];
    }
});

test('buildLatestFuelStationQuotesFromRows drops uniform multi-grade rows for non-regular queries', async () => {
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const indexPath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const userPath = require.resolve('../src/lib/user.js');

    delete require.cache[supabasePath];
    delete require.cache[indexPath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[userPath];

    primeModule(asyncStoragePath, {
        default: {
            async getItem() { return null; },
            async setItem() { },
            async removeItem() { },
            async getAllKeys() { return []; },
            async multiRemove() { },
        },
    });
    primeModule(devCounterPath, {
        incrementApiStat: () => { },
        getApiStats: async () => ({}),
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: null,
    });

    try {
        const { buildLatestFuelStationQuotesFromRows } = require(indexPath);
        const rows = [{
            station_id: 'uniform-premium',
            provider_id: 'gasbuddy',
            fuel_type: 'premium',
            all_prices: {
                regular: 3.79,
                midgrade: 3.79,
                premium: 3.79,
            },
            price: 3.79,
            currency: 'USD',
            station_name: 'Uniform Fuel',
            address: '1 Main St',
            latitude: 37.3346,
            longitude: -122.0090,
            search_latitude_rounded: 37.3,
            search_longitude_rounded: -122.0,
            source_label: 'GasBuddy',
            created_at: new Date().toISOString(),
            updated_at_source: new Date().toISOString(),
        }];
        const quotes = buildLatestFuelStationQuotesFromRows({
            rows,
            origin: {
                latitude: 37.3346,
                longitude: -122.0090,
            },
        });

        assert.equal(quotes.length, 0);
    } finally {
        delete require.cache[supabasePath];
        delete require.cache[indexPath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[userPath];
    }
});

test('buildLatestFuelStationQuotesFromRows suppresses duplicate higher grades and keeps the cheapest matching grade', async () => {
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const indexPath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const userPath = require.resolve('../src/lib/user.js');

    delete require.cache[supabasePath];
    delete require.cache[indexPath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[userPath];

    primeModule(asyncStoragePath, {
        default: {
            async getItem() { return null; },
            async setItem() { },
            async removeItem() { },
            async getAllKeys() { return []; },
            async multiRemove() { },
        },
    });
    primeModule(devCounterPath, {
        incrementApiStat: () => { },
        getApiStats: async () => ({}),
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: null,
    });

    try {
        const { buildLatestFuelStationQuotesFromRows } = require(indexPath);
        const rows = [{
            station_id: 'duplicate-midgrade',
            provider_id: 'gasbuddy',
            fuel_type: 'regular',
            all_prices: {
                regular: 3.39,
                midgrade: 3.39,
                premium: 3.79,
            },
            price: 3.39,
            currency: 'USD',
            station_name: 'Duplicate Fuel',
            address: '2 Main St',
            latitude: 37.3346,
            longitude: -122.0090,
            search_latitude_rounded: 37.3,
            search_longitude_rounded: -122.0,
            source_label: 'GasBuddy',
            created_at: new Date().toISOString(),
            updated_at_source: new Date().toISOString(),
        }];
        const quotes = buildLatestFuelStationQuotesFromRows({
            rows,
            origin: {
                latitude: 37.3346,
                longitude: -122.0090,
            },
        });

        assert.equal(quotes.length, 1);
        assert.deepEqual(quotes[0].allPrices, {
            regular: 3.39,
            premium: 3.79,
        });
        assert.deepEqual(quotes[0].availableFuelGrades, ['regular', 'premium']);
        assert.deepEqual(quotes[0].suppressedDuplicateFuelGrades, ['midgrade']);
    } finally {
        delete require.cache[supabasePath];
        delete require.cache[indexPath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[userPath];
    }
});

test('buildLatestFuelStationQuotesFromRows drops duplicate grades when the requested grade is not the cheapest match', async () => {
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const indexPath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const userPath = require.resolve('../src/lib/user.js');

    delete require.cache[supabasePath];
    delete require.cache[indexPath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[userPath];

    primeModule(asyncStoragePath, {
        default: {
            async getItem() { return null; },
            async setItem() { },
            async removeItem() { },
            async getAllKeys() { return []; },
            async multiRemove() { },
        },
    });
    primeModule(devCounterPath, {
        incrementApiStat: () => { },
        getApiStats: async () => ({}),
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: null,
    });

    try {
        const { buildLatestFuelStationQuotesFromRows } = require(indexPath);
        const rows = [{
            station_id: 'duplicate-midgrade-hidden',
            provider_id: 'gasbuddy',
            fuel_type: 'midgrade',
            all_prices: {
                regular: 3.39,
                midgrade: 3.39,
                premium: 3.79,
            },
            price: 3.39,
            currency: 'USD',
            station_name: 'Duplicate Fuel',
            address: '2 Main St',
            latitude: 37.3346,
            longitude: -122.0090,
            search_latitude_rounded: 37.3,
            search_longitude_rounded: -122.0,
            source_label: 'GasBuddy',
            created_at: new Date().toISOString(),
            updated_at_source: new Date().toISOString(),
        }];
        const quotes = buildLatestFuelStationQuotesFromRows({
            rows,
            origin: {
                latitude: 37.3346,
                longitude: -122.0090,
            },
        });

        assert.equal(quotes.length, 0);
    } finally {
        delete require.cache[supabasePath];
        delete require.cache[indexPath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[userPath];
    }
});
