const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildCacheKey,
    buildBarchartUrl,
    buildPrimaryStationRequest,
    buildSecondaryStationRequest,
    buildTomTomSearchUrl,
    PRIMARY_STATION_FUEL_MAP,
    getFuelFailureMessage,
    isCacheEntryFresh,
    normalizeBarchartResponse,
    normalizeBlsResponse,
    normalizeEiaResponse,
    normalizeFredResponse,
    normalizePrimaryStationResponse,
    normalizeSecondaryStationResponse,
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

    assert.match(url, /categorySearch\/petrol%20station\.json/);
    assert.match(url, /key=demo-key/);
    assert.match(url, /lat=40\.7128/);
    assert.match(url, /lon=-74\.006/);
    assert.match(url, /radius=12875/);
    assert.match(url, /categorySet=7311/);
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
    const quotes = normalizeBarchartResponse({
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

    assert.ok(Array.isArray(quotes));
    const quote = quotes[0];
    assert.equal(quote.providerId, 'barchart');
    assert.equal(quote.stationId, 'A1');
    assert.equal(quote.stationName, 'Speedway');
    assert.equal(quote.price, 3.099);
    assert.equal(quote.isEstimated, false);
});

test('Secondary nearby search request and payload normalize into a station quote', () => {
    const request = buildSecondaryStationRequest({
        latitude: origin.latitude,
        longitude: origin.longitude,
        radiusMiles: 5,
        config: {
            secondaryStationUrl: 'https://station-provider.invalid/search-nearby',
            secondaryStationFieldMask: 'results.id,results.displayName,results.formattedAddress',
        },
    });
    const quotes = normalizeSecondaryStationResponse({
        origin,
        fuelType: 'regular',
        payload: {
            places: [
                {
                    id: 'secondary-station-1',
                    displayName: {
                        text: 'BP',
                    },
                    formattedAddress: '1 Wall St, New York, NY',
                    location: {
                        latitude: 40.7074,
                        longitude: -74.0113,
                    },
                    fuelOptions: {
                        fuelPrices: [
                            {
                                type: 'REGULAR_UNLEADED',
                                price: {
                                    currencyCode: 'USD',
                                    units: 3,
                                    nanos: 129000000,
                                },
                                updateTime: '2026-02-28T09:30:00Z',
                            },
                        ],
                    },
                },
            ],
        },
    });

    assert.equal(request.url, 'https://station-provider.invalid/search-nearby');
    assert.deepEqual(request.body.includedTypes, ['gas_station']);
    assert.equal(request.fieldMask, 'results.id,results.displayName,results.formattedAddress');
    assert.ok(Array.isArray(quotes));
    const quote = quotes[0];
    assert.equal(quote.providerId, 'secondary');
    assert.equal(quote.stationId, 'secondary-station-1');
    assert.equal(quote.price, 3.129);
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

test('Fuel failure messaging distinguishes bad location from missing station prices', () => {
    const locationMessage = getFuelFailureMessage({
        debugState: {
            providers: [
                {
                    enabled: true,
                    providerTier: 'station',
                    failureCategory: 'location',
                },
            ],
        },
    });
    const priceMessage = getFuelFailureMessage({
        debugState: {
            providers: [
                {
                    enabled: true,
                    providerTier: 'station',
                    failureCategory: 'price',
                },
            ],
        },
    });

    assert.match(locationMessage, /did not return nearby gas stations/i);
    assert.match(priceMessage, /no prices returned/i);
});

test('cache keys are bucketed by search region and freshness respects the ttl', () => {
    const cacheKey = buildCacheKey({
        latitude: 40.71288,
        longitude: -74.00591,
        radiusMiles: 10,
        fuelType: 'regular',
        preferredProvider: 'primary',
    });

    assert.equal(cacheKey, 'fuel:regular:primary:10:40.71:-74.01');
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

test('Dedicated station feed fuel type mapping covers all app fuel types', () => {
    assert.ok(PRIMARY_STATION_FUEL_MAP.regular);
    assert.ok(PRIMARY_STATION_FUEL_MAP.midgrade);
    assert.ok(PRIMARY_STATION_FUEL_MAP.premium);
    assert.ok(PRIMARY_STATION_FUEL_MAP.diesel);
    assert.equal(PRIMARY_STATION_FUEL_MAP.regular.fuelProduct, 'regular_gas');
    assert.equal(PRIMARY_STATION_FUEL_MAP.premium.fuelId, 3);
});

test('buildPrimaryStationRequest produces a valid GraphQL POST config', () => {
    const config = buildPrimaryStationRequest({
        latitude: origin.latitude,
        longitude: origin.longitude,
        fuelType: 'regular',
        config: {
            primaryStationUrl: 'https://station-provider.invalid/query',
            primaryStationOrigin: 'https://station-provider.invalid',
            primaryStationReferer: 'https://station-provider.invalid/app',
            primaryStationPreflightHeader: 'x-preflight-check',
            primaryStationPreflightValue: 'true',
            primaryStationAuthHeader: 'x-station-auth',
            primaryStationAuthToken: 'demo-token',
        },
    });

    assert.equal(config.url, 'https://station-provider.invalid/query');
    assert.equal(config.body.operationName, 'LocationBySearchTerm');
    assert.equal(config.body.variables.fuel, 1);
    assert.equal(config.body.variables.lat, origin.latitude);
    assert.equal(config.body.variables.lng, origin.longitude);
    assert.equal(config.headers['x-preflight-check'], 'true');
    assert.ok(config.headers['Origin']);
    assert.equal(config.headers['x-station-auth'], 'demo-token');
    assert.equal(config.fuelProduct, 'regular_gas');
});

test('Dedicated station feed payload normalizes into station quotes with credit-first fallback to cash', () => {
    const quotes = normalizePrimaryStationResponse({
        origin,
        fuelType: 'regular',
        payload: {
            data: {
                locationBySearchTerm: {
                    stations: {
                        results: [
                            {
                                id: 13655,
                                name: "Sam's Club",
                                latitude: 40.71,
                                longitude: -74.01,
                                brands: [{ name: "Sam's Club" }],
                                address: {
                                    line1: '2575 Gulf-to-Bay Blvd',
                                    locality: 'Clearwater',
                                    region: 'FL',
                                    postalCode: '33765',
                                },
                                starRating: 4.7,
                                ratingsCount: 610,
                                prices: [
                                    {
                                        fuelProduct: 'regular_gas',
                                        cash: null,
                                        credit: { price: 2.61, postedTime: '2026-03-01T00:16:02.750Z' },
                                    },
                                    {
                                        fuelProduct: 'premium_gas',
                                        cash: null,
                                        credit: { price: 3.17, postedTime: '2026-03-01T00:16:02.781Z' },
                                    },
                                ],
                            },
                            {
                                id: 281,
                                name: 'Shell',
                                latitude: 40.72,
                                longitude: -74.02,
                                brands: [{ name: 'Shell' }],
                                address: {
                                    line1: '24086 US-19 N',
                                    locality: 'Clearwater',
                                    region: 'FL',
                                    postalCode: '33763',
                                },
                                starRating: 4.4,
                                ratingsCount: 371,
                                prices: [
                                    {
                                        fuelProduct: 'regular_gas',
                                        cash: { price: 2.77, postedTime: '2026-02-28T17:07:41.189Z' },
                                        credit: { price: 2.87, postedTime: '2026-02-28T17:07:41.189Z' },
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        },
    });

    assert.ok(Array.isArray(quotes));
    assert.equal(quotes.length, 2);

    // Sam's Club — credit only
    assert.equal(quotes[0].providerId, 'primary');
    assert.equal(quotes[0].providerTier, 'station');
    assert.equal(quotes[0].stationName, "Sam's Club");
    assert.equal(quotes[0].price, 2.61);
    assert.equal(quotes[0].isEstimated, false);
    assert.equal(quotes[0].rating, 4.7);
    assert.equal(quotes[0].latitude, 40.71);
    assert.equal(quotes[0].longitude, -74.01);
    assert.ok(quotes[0].allPrices.regular);
    assert.ok(quotes[0].allPrices.premium);

    // Shell — credit preferred over cash when both are present
    assert.equal(quotes[1].stationName, 'Shell');
    assert.equal(quotes[1].price, 2.87);
    assert.equal(quotes[1].latitude, 40.72);
    assert.equal(quotes[1].longitude, -74.02);
    assert.equal(quotes[1].allPrices.regular, 2.87);
    assert.equal(quotes[1].allPrices._payment.regular.credit, 2.87);
    assert.equal(quotes[1].allPrices._payment.regular.cash, 2.77);
    assert.equal(quotes[1].allPrices._payment.regular.selected, 'credit');
});

test('Dedicated station feed quote wins preferred selection', () => {
    const bestQuote = selectPreferredQuote([
        {
            providerId: 'bls',
            providerTier: 'area',
            stationId: null,
            price: 2.961,
            isEstimated: true,
        },
        {
            providerId: 'primary',
            providerTier: 'station',
            stationId: '13655',
            price: 2.61,
            isEstimated: false,
            distanceMiles: 1.2,
        },
    ]);

    assert.equal(bestQuote.providerId, 'primary');
    assert.equal(bestQuote.price, 2.61);
});
