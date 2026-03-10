const test = require('node:test');
const assert = require('node:assert/strict');
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
