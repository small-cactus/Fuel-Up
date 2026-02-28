const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildCacheKey,
    buildBarchartUrl,
    buildTomTomSearchUrl,
    isCacheEntryFresh,
    normalizeBarchartResponse,
    normalizeBlsResponse,
    normalizeEiaResponse,
    normalizeFredResponse,
    normalizeTomTomStationBundle,
    selectPreferredQuote,
} = require('../src/services/fuel/core');

const origin = {
    latitude: 40.7128,
    longitude: -74.006,
};

test('buildTomTomSearchUrl produces a location-scoped station search request', () => {
    const url = buildTomTomSearchUrl({
        apiKey: 'demo-key',
        latitude: origin.latitude,
        longitude: origin.longitude,
        radiusMiles: 8,
        limit: 6,
    });

    assert.match(url, /categorySearch\/gas%20station\.json/);
    assert.match(url, /key=demo-key/);
    assert.match(url, /lat=40\.7128/);
    assert.match(url, /lon=-74\.006/);
    assert.match(url, /radius=12875/);
    assert.match(url, /limit=6/);
});

test('buildBarchartUrl supports geographic and postal lookups', () => {
    const geoUrl = buildBarchartUrl({
        apiKey: 'bar-key',
        latitude: origin.latitude,
        longitude: origin.longitude,
        radiusMiles: 5,
        fuelType: 'regular',
    });
    const zipUrl = buildBarchartUrl({
        apiKey: 'bar-key',
        zipCode: '10001',
        radiusMiles: 5,
        fuelType: 'diesel',
    });

    assert.match(geoUrl, /apikey=bar-key/);
    assert.match(geoUrl, /latitude=40\.7128/);
    assert.match(geoUrl, /longitude=-74\.006/);
    assert.match(geoUrl, /productName=regular/i);
    assert.match(zipUrl, /zipCode=10001/);
    assert.match(zipUrl, /productName=diesel/i);
});

test('TomTom station bundle normalizes into an actual station quote', () => {
    const quote = normalizeTomTomStationBundle({
        origin,
        fuelType: 'regular',
        searchResult: {
            id: 'poi-123',
            position: {
                lat: 40.715,
                lon: -74.011,
            },
            poi: {
                name: 'Shell',
            },
        },
        placeResult: {
            id: 'poi-123',
            address: {
                freeformAddress: '123 Main St, New York, NY',
            },
            dataSources: {
                fuelPrice: {
                    id: 'fuel-123',
                },
            },
        },
        fuelPriceResult: {
            fuelPrices: [
                {
                    fuelType: 'regular',
                    price: 3.159,
                    currency: 'USD',
                    lastUpdated: '2026-02-28T09:00:00Z',
                },
            ],
        },
    });

    assert.equal(quote.providerId, 'tomtom');
    assert.equal(quote.providerTier, 'station');
    assert.equal(quote.stationId, 'poi-123');
    assert.equal(quote.stationName, 'Shell');
    assert.equal(quote.address, '123 Main St, New York, NY');
    assert.equal(quote.price, 3.159);
    assert.equal(quote.currency, 'USD');
    assert.equal(quote.isEstimated, false);
    assert.ok(quote.distanceMiles > 0);
});

test('Barchart payload normalizes and filters to the requested fuel type', () => {
    const quote = normalizeBarchartResponse({
        origin,
        fuelType: 'regular',
        payload: {
            status: {
                code: 200,
            },
            results: [
                {
                    stationId: 'A1',
                    stationName: 'Speedway',
                    address: '12 Broadway, New York, NY',
                    latitude: 40.714,
                    longitude: -74.005,
                    productName: 'Regular',
                    price: '3.099',
                    updated: '2026-02-28T08:30:00Z',
                },
                {
                    stationId: 'A2',
                    stationName: 'Speedway',
                    address: '99 Broadway, New York, NY',
                    latitude: 40.713,
                    longitude: -74.004,
                    productName: 'Diesel',
                    price: '3.999',
                },
            ],
        },
    });

    assert.equal(quote.providerId, 'barchart');
    assert.equal(quote.stationId, 'A1');
    assert.equal(quote.stationName, 'Speedway');
    assert.equal(quote.price, 3.099);
    assert.equal(quote.isEstimated, false);
});

test('Public area-level providers normalize into estimated quotes', () => {
    const blsQuote = normalizeBlsResponse({
        origin,
        fuelType: 'regular',
        payload: {
            status: 'REQUEST_SUCCEEDED',
            Results: {
                series: [
                    {
                        seriesID: 'APU000074714',
                        data: [
                            {
                                year: '2026',
                                period: 'M01',
                                periodName: 'January',
                                value: '2.961',
                            },
                        ],
                    },
                ],
            },
        },
    });
    const eiaQuote = normalizeEiaResponse({
        origin,
        fuelType: 'regular',
        payload: {
            response: {
                data: [
                    {
                        period: '2026-02-23',
                        value: '3.104',
                    },
                ],
            },
        },
    });
    const fredQuote = normalizeFredResponse({
        origin,
        fuelType: 'regular',
        payload: {
            observations: [
                {
                    date: '2026-02-20',
                    value: '3.010',
                },
            ],
        },
    });

    for (const quote of [blsQuote, eiaQuote, fredQuote]) {
        assert.equal(quote.providerTier, 'area');
        assert.equal(quote.isEstimated, true);
        assert.equal(quote.stationId, null);
        assert.equal(quote.latitude, origin.latitude);
        assert.equal(quote.longitude, origin.longitude);
        assert.ok(quote.price > 0);
    }
});

test('Cheapest actual station wins over estimated fallbacks', () => {
    const bestQuote = selectPreferredQuote([
        {
            providerId: 'bls',
            providerTier: 'area',
            stationId: null,
            stationName: 'National average',
            address: 'United States',
            latitude: origin.latitude,
            longitude: origin.longitude,
            price: 2.961,
            currency: 'USD',
            priceUnit: 'gallon',
            fuelType: 'regular',
            distanceMiles: 0,
            fetchedAt: '2026-02-28T10:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            isEstimated: true,
            sourceLabel: 'BLS average',
        },
        {
            providerId: 'tomtom',
            providerTier: 'station',
            stationId: 'poi-123',
            stationName: 'Shell',
            address: '123 Main St',
            latitude: 40.715,
            longitude: -74.011,
            price: 3.159,
            currency: 'USD',
            priceUnit: 'gallon',
            fuelType: 'regular',
            distanceMiles: 0.4,
            fetchedAt: '2026-02-28T10:00:00.000Z',
            updatedAt: '2026-02-28T09:00:00.000Z',
            isEstimated: false,
            sourceLabel: 'TomTom Fuel Prices',
        },
        {
            providerId: 'barchart',
            providerTier: 'station',
            stationId: 'A1',
            stationName: 'Speedway',
            address: '12 Broadway',
            latitude: 40.714,
            longitude: -74.005,
            price: 3.099,
            currency: 'USD',
            priceUnit: 'gallon',
            fuelType: 'regular',
            distanceMiles: 0.1,
            fetchedAt: '2026-02-28T10:00:00.000Z',
            updatedAt: '2026-02-28T08:30:00.000Z',
            isEstimated: false,
            sourceLabel: 'Barchart OnDemand',
        },
    ]);

    assert.equal(bestQuote.providerId, 'barchart');
    assert.equal(bestQuote.stationId, 'A1');
});

test('No station quotes means no preferred quote is returned', () => {
    const bestQuote = selectPreferredQuote([
        {
            providerId: 'bls',
            providerTier: 'area',
            stationId: null,
            stationName: 'National average',
            address: 'United States',
            latitude: origin.latitude,
            longitude: origin.longitude,
            price: 2.961,
            currency: 'USD',
            priceUnit: 'gallon',
            fuelType: 'regular',
            distanceMiles: 0,
            fetchedAt: '2026-02-28T10:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            isEstimated: true,
            sourceLabel: 'BLS average',
        },
    ]);

    assert.equal(bestQuote, null);
});

test('cache keys are bucketed by search region and freshness respects the ttl', () => {
    const cacheKey = buildCacheKey({
        latitude: 40.71288,
        longitude: -74.00591,
        radiusMiles: 10,
        fuelType: 'regular',
    });

    assert.equal(cacheKey, 'fuel:regular:10:40.71:-74.01');
    assert.equal(
        isCacheEntryFresh(
            {
                fetchedAt: '2026-02-28T10:00:00.000Z',
            },
            15 * 60 * 1000,
            '2026-02-28T10:10:00.000Z'
        ),
        true
    );
    assert.equal(
        isCacheEntryFresh(
            {
                fetchedAt: '2026-02-28T10:00:00.000Z',
            },
            15 * 60 * 1000,
            '2026-02-28T10:20:01.000Z'
        ),
        false
    );
});
