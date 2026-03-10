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
