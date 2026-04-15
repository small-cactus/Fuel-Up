const test = require('node:test');
const assert = require('node:assert/strict');

function createAsyncStorageMock() {
    const storage = new Map();

    return {
        storage,
        module: {
            async getItem(key) {
                return storage.has(key) ? storage.get(key) : null;
            },
            async setItem(key, value) {
                storage.set(key, value);
            },
            async removeItem(key) {
                storage.delete(key);
            },
            async getAllKeys() {
                return [...storage.keys()];
            },
            async multiRemove(keys) {
                keys.forEach(key => {
                    storage.delete(key);
                });
            },
        },
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
        station_name: `Station ${stationId}`,
        address: `${stationId} Main St`,
        latitude,
        longitude,
        search_latitude_rounded: 37.3,
        search_longitude_rounded: -122,
        source_label: 'GasBuddy',
        rating: 4.2,
        user_rating_count: 12,
        created_at: new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString(),
        updated_at_source: new Date(Date.now() - (sourceHoursAgo * 60 * 60 * 1000)).toISOString(),
    };
}

test('clearFuelPriceCache prevents in-flight requests from repopulating cached fuel data', async () => {
    const asyncStorageMock = createAsyncStorageMock();
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const fuelServicePath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');

    delete require.cache[fuelServicePath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[supabasePath];

    primeModule(asyncStoragePath, {
        default: asyncStorageMock.module,
    });
    primeModule(devCounterPath, {
        getApiStats: async () => ({}),
        incrementApiStat: () => { },
        resetApiStats: async () => ({}),
    });
    primeModule(supabasePath, {
        supabase: null,
        hasSupabaseConfig: false,
    });

    const originalFetch = global.fetch;
    const originalDevFlag = global.__DEV__;
    const originalConsoleError = console.error;
    let resolveFetch;

    global.__DEV__ = false;
    global.fetch = () => new Promise(resolve => {
        resolveFetch = resolve;
    });
    console.error = (...args) => {
        if (String(args[0] || '').includes('GasBuddy fallback lookup failed')) {
            return;
        }

        originalConsoleError(...args);
    };

    try {
        const {
            clearFuelPriceCache,
            getCachedFuelPriceSnapshot,
            isFuelCacheResetError,
            refreshFuelPriceSnapshot,
        } = require(fuelServicePath);

        const query = {
            latitude: 37.3346,
            longitude: -122.009,
            radiusMiles: 10,
            fuelType: 'regular',
            allowLiveGasBuddy: true,
            preferredProvider: 'gasbuddy',
            forceLiveGasBuddy: true,
        };

        const request = refreshFuelPriceSnapshot(query);

        await clearFuelPriceCache();

        resolveFetch({
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    data: {
                        locationBySearchTerm: {
                            stations: {
                                results: [
                                    {
                                        id: 'station-1',
                                        name: 'Shell',
                                        latitude: query.latitude,
                                        longitude: query.longitude,
                                        address: {
                                            line1: '1 Infinite Loop',
                                            locality: 'Cupertino',
                                            region: 'CA',
                                            postalCode: '95014',
                                        },
                                        prices: [
                                            {
                                                fuelProduct: 'regular_gas',
                                                credit: {
                                                    price: 3.459,
                                                    postedTime: '2026-03-10T12:00:00.000Z',
                                                },
                                            },
                                        ],
                                        ratingsCount: 42,
                                        starRating: 4.5,
                                    },
                                ],
                            },
                        },
                    },
                });
            },
        });

        await assert.rejects(request, error => {
            assert.equal(isFuelCacheResetError(error), true);
            return true;
        });

        const cachedSnapshot = await getCachedFuelPriceSnapshot(query);

        assert.equal(cachedSnapshot, null);
        assert.deepEqual(
            [...asyncStorageMock.storage.keys()].filter(key => key.startsWith('fuel:')),
            []
        );
    } finally {
        global.fetch = originalFetch;
        global.__DEV__ = originalDevFlag;
        console.error = originalConsoleError;
        delete require.cache[fuelServicePath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[supabasePath];
    }
});

test('refreshFuelPriceSnapshot falls through to live GasBuddy when the Supabase cache is empty', async () => {
    const asyncStorageMock = createAsyncStorageMock();
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const fuelServicePath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');

    delete require.cache[fuelServicePath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[supabasePath];

    primeModule(asyncStoragePath, {
        default: asyncStorageMock.module,
    });
    primeModule(devCounterPath, {
        getApiStats: async () => ({}),
        incrementApiStat: () => { },
        resetApiStats: async () => ({}),
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: {
            from(tableName) {
                assert.equal(tableName, 'station_prices');

                return {
                    select() {
                        return this;
                    },
                    eq() {
                        return this;
                    },
                    gte() {
                        return Promise.resolve({
                            data: [],
                            error: null,
                        });
                    },
                };
            },
        },
    });

    const originalFetch = global.fetch;
    const originalDevFlag = global.__DEV__;
    let fetchCalled = false;
    let fetchedUrl = null;

    global.__DEV__ = false;
    global.fetch = async (url) => {
        fetchCalled = true;
        fetchedUrl = typeof url === 'string' ? url : url?.url || null;
        // Simulate a network-level failure so the live path cannot produce
        // quotes and we verify that the error propagates with the expected
        // "no usable data" message.
        throw new Error('Simulated GasBuddy live fetch failure');
    };

    try {
        const { refreshFuelPriceSnapshot } = require(fuelServicePath);

        await assert.rejects(
            refreshFuelPriceSnapshot({
                latitude: 37.3346,
                longitude: -122.009,
                radiusMiles: 10,
                fuelType: 'regular',
                preferredProvider: 'gasbuddy',
            }),
            error => {
                assert.equal(
                    error?.message,
                    'No fuel price providers returned usable data.'
                );
                return true;
            }
        );

        assert.equal(fetchCalled, true, 'Expected live GasBuddy fetch to be invoked on cache miss.');
        assert.ok(
            fetchedUrl && fetchedUrl.includes('gasbuddy.com'),
            `Expected live fetch to target gasbuddy.com, got ${fetchedUrl}`
        );
    } finally {
        global.fetch = originalFetch;
        global.__DEV__ = originalDevFlag;
        delete require.cache[fuelServicePath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[supabasePath];
    }
});

test('refreshFuelPriceSnapshot persists the validated live price instead of the raw API replay', async () => {
    const asyncStorageMock = createAsyncStorageMock();
    const insertedRows = [];
    const areaHistoryRows = [
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
    ];
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const userPath = require.resolve('../src/lib/user.js');
    const fuelServicePath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');

    delete require.cache[fuelServicePath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[supabasePath];
    delete require.cache[userPath];

    primeModule(asyncStoragePath, {
        default: asyncStorageMock.module,
    });
    primeModule(devCounterPath, {
        getApiStats: async () => ({}),
        incrementApiStat: () => { },
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: {
            from(tableName) {
                assert.equal(tableName, 'station_prices');

                return {
                    select() {
                        return {
                            eq() {
                                return this;
                            },
                            gte() {
                                return this;
                            },
                            order() {
                                return this;
                            },
                            limit() {
                                return Promise.resolve({
                                    data: areaHistoryRows,
                                    error: null,
                                });
                            },
                        };
                    },
                    insert(rows) {
                        insertedRows.push(...rows);
                        return Promise.resolve({ error: null });
                    },
                };
            },
        },
    });

    const originalFetch = global.fetch;
    const originalDevFlag = global.__DEV__;

    global.__DEV__ = false;
    global.fetch = async () => ({
        ok: true,
        status: 200,
        async text() {
            return JSON.stringify({
                data: {
                    locationBySearchTerm: {
                        stations: {
                            results: [
                                {
                                    id: 'A',
                                    name: 'Dodge Store',
                                    latitude: 37.3346,
                                    longitude: -122.0090,
                                    address: {
                                        line1: '1 Main St',
                                        locality: 'Cupertino',
                                        region: 'CA',
                                        postalCode: '95014',
                                    },
                                    prices: [
                                        {
                                            fuelProduct: 'regular_gas',
                                            credit: {
                                                price: 3.10,
                                                postedTime: new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString(),
                                            },
                                        },
                                    ],
                                    ratingsCount: 42,
                                    starRating: 4.5,
                                },
                            ],
                        },
                    },
                },
            });
        },
    });

    try {
        const { refreshFuelPriceSnapshot } = require(fuelServicePath);
        const result = await refreshFuelPriceSnapshot({
            latitude: 37.3346,
            longitude: -122.0090,
            radiusMiles: 10,
            fuelType: 'regular',
            allowLiveGasBuddy: true,
            preferredProvider: 'gasbuddy',
            forceLiveGasBuddy: true,
        });
        const persistedStation = (result?.snapshot?.topStations || []).find(
            quote => String(quote?.stationId || '') === 'A'
        );

        assert.equal(insertedRows.length, 1);
        assert.ok((persistedStation?.price || 0) > 3.10);
        assert.equal(insertedRows[0].price, persistedStation.price);
        assert.equal(insertedRows[0].all_prices.regular, persistedStation.allPrices.regular);
    } finally {
        global.fetch = originalFetch;
        global.__DEV__ = originalDevFlag;
        delete require.cache[fuelServicePath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[supabasePath];
        delete require.cache[userPath];
    }
});

test('refreshFuelPriceSnapshot rejects live uniform multi-grade stations for non-regular fuel requests', async () => {
    const asyncStorageMock = createAsyncStorageMock();
    const insertedRows = [];
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const userPath = require.resolve('../src/lib/user.js');
    const fuelServicePath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');

    delete require.cache[fuelServicePath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[supabasePath];
    delete require.cache[userPath];

    primeModule(asyncStoragePath, {
        default: asyncStorageMock.module,
    });
    primeModule(devCounterPath, {
        getApiStats: async () => ({}),
        incrementApiStat: () => { },
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: {
            from(tableName) {
                assert.equal(tableName, 'station_prices');

                return {
                    select() {
                        return {
                            eq() {
                                return this;
                            },
                            gte() {
                                return this;
                            },
                            order() {
                                return this;
                            },
                            limit() {
                                return Promise.resolve({
                                    data: [],
                                    error: null,
                                });
                            },
                            then(resolve) {
                                return Promise.resolve({
                                    data: [],
                                    error: null,
                                }).then(resolve);
                            },
                        };
                    },
                    insert(rows) {
                        insertedRows.push(...rows);
                        return Promise.resolve({ error: null });
                    },
                };
            },
        },
    });

    const originalFetch = global.fetch;
    const originalDevFlag = global.__DEV__;

    global.__DEV__ = false;
    global.fetch = async () => ({
        ok: true,
        status: 200,
        async text() {
            return JSON.stringify({
                data: {
                    locationBySearchTerm: {
                        stations: {
                            results: [
                                {
                                    id: 'uniform-premium',
                                    name: 'Uniform Fuel',
                                    latitude: 37.3346,
                                    longitude: -122.0090,
                                    address: {
                                        line1: '1 Main St',
                                        locality: 'Cupertino',
                                        region: 'CA',
                                        postalCode: '95014',
                                    },
                                    prices: [
                                        {
                                            fuelProduct: 'regular_gas',
                                            credit: { price: 3.79, postedTime: new Date().toISOString() },
                                        },
                                        {
                                            fuelProduct: 'midgrade_gas',
                                            credit: { price: 3.79, postedTime: new Date().toISOString() },
                                        },
                                        {
                                            fuelProduct: 'premium_gas',
                                            credit: { price: 3.79, postedTime: new Date().toISOString() },
                                        },
                                    ],
                                    ratingsCount: 42,
                                    starRating: 4.5,
                                },
                            ],
                        },
                    },
                },
            });
        },
    });

    try {
        const { refreshFuelPriceSnapshot } = require(fuelServicePath);

        await assert.rejects(
            refreshFuelPriceSnapshot({
                latitude: 37.3346,
                longitude: -122.0090,
                radiusMiles: 10,
                fuelType: 'premium',
                allowLiveGasBuddy: true,
                preferredProvider: 'gasbuddy',
                forceLiveGasBuddy: true,
            }),
            error => {
                assert.match(String(error?.userMessage || ''), /No prices returned/i);
                return true;
            }
        );

        assert.equal(insertedRows.length, 0);
    } finally {
        global.fetch = originalFetch;
        global.__DEV__ = originalDevFlag;
        delete require.cache[fuelServicePath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[supabasePath];
        delete require.cache[userPath];
    }
});

test('refreshFuelPriceSnapshot suppresses duplicate higher grades in live station quotes', async () => {
    const asyncStorageMock = createAsyncStorageMock();
    const insertedRows = [];
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const userPath = require.resolve('../src/lib/user.js');
    const fuelServicePath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');

    delete require.cache[fuelServicePath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[supabasePath];
    delete require.cache[userPath];

    primeModule(asyncStoragePath, {
        default: asyncStorageMock.module,
    });
    primeModule(devCounterPath, {
        getApiStats: async () => ({}),
        incrementApiStat: () => { },
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: {
            from(tableName) {
                assert.equal(tableName, 'station_prices');

                return {
                    select() {
                        return {
                            eq() {
                                return this;
                            },
                            gte() {
                                return this;
                            },
                            order() {
                                return this;
                            },
                            limit() {
                                return Promise.resolve({
                                    data: [],
                                    error: null,
                                });
                            },
                            then(resolve) {
                                return Promise.resolve({
                                    data: [],
                                    error: null,
                                }).then(resolve);
                            },
                        };
                    },
                    insert(rows) {
                        insertedRows.push(...rows);
                        return Promise.resolve({ error: null });
                    },
                };
            },
        },
    });

    const originalFetch = global.fetch;
    const originalDevFlag = global.__DEV__;

    global.__DEV__ = false;
    global.fetch = async () => ({
        ok: true,
        status: 200,
        async text() {
            return JSON.stringify({
                data: {
                    locationBySearchTerm: {
                        stations: {
                            results: [
                                {
                                    id: 'duplicate-midgrade',
                                    name: 'Duplicate Fuel',
                                    latitude: 37.3346,
                                    longitude: -122.0090,
                                    address: {
                                        line1: '2 Main St',
                                        locality: 'Cupertino',
                                        region: 'CA',
                                        postalCode: '95014',
                                    },
                                    prices: [
                                        {
                                            fuelProduct: 'regular_gas',
                                            credit: { price: 3.39, postedTime: new Date().toISOString() },
                                        },
                                        {
                                            fuelProduct: 'midgrade_gas',
                                            credit: { price: 3.39, postedTime: new Date().toISOString() },
                                        },
                                        {
                                            fuelProduct: 'premium_gas',
                                            credit: { price: 3.79, postedTime: new Date().toISOString() },
                                        },
                                    ],
                                    ratingsCount: 42,
                                    starRating: 4.5,
                                },
                            ],
                        },
                    },
                },
            });
        },
    });

    try {
        const { refreshFuelPriceSnapshot } = require(fuelServicePath);

        const result = await refreshFuelPriceSnapshot({
            latitude: 37.3346,
            longitude: -122.0090,
            radiusMiles: 10,
            fuelType: 'regular',
            allowLiveGasBuddy: true,
            preferredProvider: 'gasbuddy',
            forceLiveGasBuddy: true,
        });
        const topStation = result?.snapshot?.topStations?.[0] || null;

        assert.equal(insertedRows.length, 1);
        assert.ok(topStation);
        assert.equal(topStation.allPrices.regular, 3.39);
        assert.equal(topStation.allPrices.premium, 3.79);
        assert.equal(topStation.allPrices.midgrade, undefined);
        assert.equal(topStation.allPrices._payment?.regular?.credit, 3.39);
        assert.equal(topStation.allPrices._payment?.premium?.credit, 3.79);
        assert.equal(topStation.allPrices._payment?.midgrade, undefined);
        assert.deepEqual(topStation.availableFuelGrades, ['regular', 'premium']);
        assert.deepEqual(topStation.suppressedDuplicateFuelGrades, ['midgrade']);
        assert.equal(insertedRows[0].all_prices.regular, 3.39);
        assert.equal(insertedRows[0].all_prices.premium, 3.79);
        assert.equal(insertedRows[0].all_prices.midgrade, undefined);
        assert.equal(insertedRows[0].all_prices._payment?.regular?.credit, 3.39);
        assert.equal(insertedRows[0].all_prices._payment?.premium?.credit, 3.79);
        assert.equal(insertedRows[0].all_prices._payment?.midgrade, undefined);
    } finally {
        global.fetch = originalFetch;
        global.__DEV__ = originalDevFlag;
        delete require.cache[fuelServicePath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[supabasePath];
        delete require.cache[userPath];
    }
});

test('refreshFuelPriceSnapshot rejects live duplicate grades when the requested grade is not the cheapest match', async () => {
    const asyncStorageMock = createAsyncStorageMock();
    const insertedRows = [];
    const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
    const devCounterPath = require.resolve('../src/lib/devCounter.js');
    const supabasePath = require.resolve('../src/lib/supabase.js');
    const userPath = require.resolve('../src/lib/user.js');
    const fuelServicePath = require.resolve('../src/services/fuel/index.js');
    const cacheStorePath = require.resolve('../src/services/fuel/cacheStore.js');

    delete require.cache[fuelServicePath];
    delete require.cache[cacheStorePath];
    delete require.cache[asyncStoragePath];
    delete require.cache[devCounterPath];
    delete require.cache[supabasePath];
    delete require.cache[userPath];

    primeModule(asyncStoragePath, {
        default: asyncStorageMock.module,
    });
    primeModule(devCounterPath, {
        getApiStats: async () => ({}),
        incrementApiStat: () => { },
        resetApiStats: async () => ({}),
    });
    primeModule(userPath, {
        getUserUuid: async () => 'test-user',
    });
    primeModule(supabasePath, {
        hasSupabaseConfig: true,
        supabase: {
            from(tableName) {
                assert.equal(tableName, 'station_prices');

                return {
                    select() {
                        return {
                            eq() {
                                return this;
                            },
                            gte() {
                                return this;
                            },
                            order() {
                                return this;
                            },
                            limit() {
                                return Promise.resolve({
                                    data: [],
                                    error: null,
                                });
                            },
                            then(resolve) {
                                return Promise.resolve({
                                    data: [],
                                    error: null,
                                }).then(resolve);
                            },
                        };
                    },
                    insert(rows) {
                        insertedRows.push(...rows);
                        return Promise.resolve({ error: null });
                    },
                };
            },
        },
    });

    const originalFetch = global.fetch;
    const originalDevFlag = global.__DEV__;

    global.__DEV__ = false;
    global.fetch = async () => ({
        ok: true,
        status: 200,
        async text() {
            return JSON.stringify({
                data: {
                    locationBySearchTerm: {
                        stations: {
                            results: [
                                {
                                    id: 'duplicate-midgrade-hidden',
                                    name: 'Duplicate Fuel',
                                    latitude: 37.3346,
                                    longitude: -122.0090,
                                    address: {
                                        line1: '2 Main St',
                                        locality: 'Cupertino',
                                        region: 'CA',
                                        postalCode: '95014',
                                    },
                                    prices: [
                                        {
                                            fuelProduct: 'regular_gas',
                                            credit: { price: 3.39, postedTime: new Date().toISOString() },
                                        },
                                        {
                                            fuelProduct: 'midgrade_gas',
                                            credit: { price: 3.39, postedTime: new Date().toISOString() },
                                        },
                                        {
                                            fuelProduct: 'premium_gas',
                                            credit: { price: 3.79, postedTime: new Date().toISOString() },
                                        },
                                    ],
                                    ratingsCount: 42,
                                    starRating: 4.5,
                                },
                            ],
                        },
                    },
                },
            });
        },
    });

    try {
        const { refreshFuelPriceSnapshot } = require(fuelServicePath);

        await assert.rejects(
            refreshFuelPriceSnapshot({
                latitude: 37.3346,
                longitude: -122.0090,
                radiusMiles: 10,
                fuelType: 'midgrade',
                allowLiveGasBuddy: true,
                preferredProvider: 'gasbuddy',
                forceLiveGasBuddy: true,
            }),
            error => {
                assert.match(String(error?.userMessage || ''), /No prices returned/i);
                return true;
            }
        );

        assert.equal(insertedRows.length, 0);
    } finally {
        global.fetch = originalFetch;
        global.__DEV__ = originalDevFlag;
        delete require.cache[fuelServicePath];
        delete require.cache[cacheStorePath];
        delete require.cache[asyncStoragePath];
        delete require.cache[devCounterPath];
        delete require.cache[supabasePath];
        delete require.cache[userPath];
    }
});
