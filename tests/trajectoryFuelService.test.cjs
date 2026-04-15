const test = require('node:test');
const assert = require('node:assert/strict');

const {
    refreshFuelPriceSnapshotAlongTrajectory,
    refreshFuelPriceSnapshotWithTrajectoryFallback,
} = require('../src/services/fuel');

function createStationQuote({
    stationId,
    stationName,
    latitude,
    longitude,
    price,
    distanceMiles,
}) {
    return {
        providerId: 'gasbuddy',
        providerTier: 'station',
        stationId,
        stationName,
        address: `${stationName} Address`,
        latitude,
        longitude,
        fuelType: 'regular',
        price,
        distanceMiles,
        isEstimated: false,
        sourceLabel: 'GasBuddy',
        fetchedAt: '2026-04-14T12:00:00.000Z',
    };
}

test('refreshFuelPriceSnapshotAlongTrajectory merges current and ahead stations and chooses the cheaper ahead stop', async () => {
    const fetchedQueries = [];
    const cachedEntries = [];
    const originStation = createStationQuote({
        stationId: 'origin-pricey',
        stationName: 'Origin Pricey',
        latitude: 0,
        longitude: 0.01,
        price: 3.49,
        distanceMiles: 0.7,
    });
    const aheadStation = createStationQuote({
        stationId: 'ahead-cheap',
        stationName: 'Ahead Cheap',
        latitude: 0,
        longitude: 0.09,
        price: 3.05,
        distanceMiles: 0.5,
    });

    const result = await refreshFuelPriceSnapshotAlongTrajectory({
        latitude: 0,
        longitude: 0,
        courseDegrees: 90,
        speedMps: 21,
        radiusMiles: 10,
        fuelType: 'regular',
        preferredProvider: 'gasbuddy',
        lookaheadMeters: 10_000,
        routeTargetMeters: 16_000,
        routeProvider: async () => ({
            distanceMeters: 17_000,
            coordinates: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: 0.06 },
                { latitude: 0, longitude: 0.12 },
                { latitude: 0, longitude: 0.16 },
            ],
            steps: [
                { instructions: 'Stay on the highway' },
                { instructions: 'Keep right' },
            ],
        }),
        snapshotFetcher: async (query) => {
            fetchedQueries.push(query);
            if (query.longitude === 0) {
                return {
                    debugState: { providers: [{ providerId: 'gasbuddy', providerTier: 'station', enabled: true }] },
                    snapshot: {
                        quote: originStation,
                        topStations: [originStation],
                        regionalQuotes: [],
                        fetchedAt: '2026-04-14T12:00:00.000Z',
                    },
                };
            }

            return {
                debugState: { providers: [{ providerId: 'gasbuddy', providerTier: 'station', enabled: true }] },
                snapshot: {
                    quote: aheadStation,
                    topStations: [aheadStation],
                    regionalQuotes: [],
                    fetchedAt: '2026-04-14T12:00:00.000Z',
                },
            };
        },
        cacheWriter: async (key, value) => {
            cachedEntries.push({ key, value });
            return value;
        },
    });

    assert.equal(fetchedQueries.length, 2);
    assert.equal(result.snapshot.quote.stationId, 'ahead-cheap');
    assert.equal(result.snapshot.topStations[0].stationId, 'ahead-cheap');
    assert.ok(result.snapshot.topStations[0].distanceMiles > result.snapshot.topStations[1].distanceMiles);
    assert.ok(result.snapshot.topStations[0].effectivePrice >= result.snapshot.topStations[0].price);
    assert.ok(result.snapshot.topStations[0].routeApproach);
    assert.equal(result.debugState.summary.baseStationCount, 1);
    assert.equal(result.debugState.summary.aheadStationCount, 1);
    assert.equal(result.debugState.summary.mergedStationCount, 2);
    assert.equal(cachedEntries.length, 1);
    assert.match(cachedEntries[0].key, /^fuel-trajectory:fuel:regular:/);
    assert.ok(result.snapshot.trajectory?.aheadPoint);
});

test('refreshFuelPriceSnapshotAlongTrajectory keeps merged route snapshots out of the nearby cache namespace', async () => {
    const cachedEntries = [];

    await refreshFuelPriceSnapshotAlongTrajectory({
        latitude: 0,
        longitude: 0,
        courseDegrees: 90,
        speedMps: 21,
        radiusMiles: 10,
        fuelType: 'regular',
        preferredProvider: 'gasbuddy',
        lookaheadMeters: 10_000,
        routeTargetMeters: 16_000,
        routeProvider: async () => ({
            distanceMeters: 17_000,
            coordinates: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: 0.06 },
                { latitude: 0, longitude: 0.12 },
            ],
            steps: [{ instructions: 'Continue straight' }],
        }),
        snapshotFetcher: async (query) => ({
            debugState: { providers: [{ providerId: 'gasbuddy', providerTier: 'station', enabled: true }] },
            snapshot: {
                quote: createStationQuote({
                    stationId: query.longitude === 0 ? 'origin' : 'ahead',
                    stationName: query.longitude === 0 ? 'Origin' : 'Ahead',
                    latitude: 0,
                    longitude: query.longitude === 0 ? 0.01 : 0.09,
                    price: query.longitude === 0 ? 3.39 : 3.09,
                    distanceMiles: 1,
                }),
                topStations: [
                    createStationQuote({
                        stationId: query.longitude === 0 ? 'origin' : 'ahead',
                        stationName: query.longitude === 0 ? 'Origin' : 'Ahead',
                        latitude: 0,
                        longitude: query.longitude === 0 ? 0.01 : 0.09,
                        price: query.longitude === 0 ? 3.39 : 3.09,
                        distanceMiles: 1,
                    }),
                ],
                regionalQuotes: [],
                fetchedAt: '2026-04-14T12:00:00.000Z',
            },
        }),
        cacheWriter: async (key, value) => {
            cachedEntries.push({ key, value });
            return value;
        },
    });

    assert.equal(cachedEntries.length, 1);
    assert.match(cachedEntries[0].key, /^fuel-trajectory:/);
    assert.doesNotMatch(cachedEntries[0].key, /^fuel:regular:/);
});

test('refreshFuelPriceSnapshotAlongTrajectory dedupes identical concurrent requests at the wrapper level', async () => {
    let fetchCallCount = 0;
    const sharedFetcher = async (query) => {
        fetchCallCount += 1;
        await new Promise(resolve => setTimeout(resolve, 25));
        return {
            debugState: { providers: [{ providerId: 'gasbuddy', providerTier: 'station', enabled: true }] },
            snapshot: {
                quote: createStationQuote({
                    stationId: query.longitude === 0 ? 'origin' : 'ahead',
                    stationName: query.longitude === 0 ? 'Origin' : 'Ahead',
                    latitude: 0,
                    longitude: query.longitude === 0 ? 0.01 : 0.09,
                    price: query.longitude === 0 ? 3.39 : 3.09,
                    distanceMiles: 1,
                }),
                topStations: [
                    createStationQuote({
                        stationId: query.longitude === 0 ? 'origin' : 'ahead',
                        stationName: query.longitude === 0 ? 'Origin' : 'Ahead',
                        latitude: 0,
                        longitude: query.longitude === 0 ? 0.01 : 0.09,
                        price: query.longitude === 0 ? 3.39 : 3.09,
                        distanceMiles: 1,
                    }),
                ],
                regionalQuotes: [],
                fetchedAt: '2026-04-14T12:00:00.000Z',
            },
        };
    };
    const input = {
        latitude: 0,
        longitude: 0,
        courseDegrees: 90,
        speedMps: 21,
        radiusMiles: 10,
        fuelType: 'regular',
        preferredProvider: 'gasbuddy',
        lookaheadMeters: 10_000,
        routeTargetMeters: 16_000,
        routeProvider: async () => ({
            distanceMeters: 17_000,
            coordinates: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: 0.06 },
                { latitude: 0, longitude: 0.12 },
            ],
            steps: [{ instructions: 'Continue straight', distanceMeters: 4000 }],
        }),
        snapshotFetcher: sharedFetcher,
        cacheWriter: async (_key, value) => value,
    };

    const [first, second] = await Promise.all([
        refreshFuelPriceSnapshotAlongTrajectory(input),
        refreshFuelPriceSnapshotAlongTrajectory(input),
    ]);

    assert.equal(fetchCallCount, 2);
    assert.equal(first.snapshot.quote.stationId, 'ahead');
    assert.equal(second.snapshot.quote.stationId, 'ahead');
});

test('refreshFuelPriceSnapshotWithTrajectoryFallback falls back to the normal snapshot when routing is unavailable', async () => {
    const fallbackStation = createStationQuote({
        stationId: 'fallback-origin',
        stationName: 'Fallback Origin',
        latitude: 0,
        longitude: 0.01,
        price: 3.29,
        distanceMiles: 0.8,
    });
    const fallbackQueries = [];

    const result = await refreshFuelPriceSnapshotWithTrajectoryFallback({
        latitude: 0,
        longitude: 0,
        courseDegrees: 90,
        speedMps: 21,
        radiusMiles: 10,
        fuelType: 'regular',
        preferredProvider: 'gasbuddy',
        routeProvider: async () => {
            throw new Error('FuelUpMapKitRouting is unavailable on this platform.');
        },
        fallbackSnapshotFetcher: async (query) => {
            fallbackQueries.push(query);
            return {
                debugState: { providers: [{ providerId: 'gasbuddy', providerTier: 'station', enabled: true }] },
                snapshot: {
                    quote: fallbackStation,
                    topStations: [fallbackStation],
                    regionalQuotes: [],
                    fetchedAt: '2026-04-14T12:00:00.000Z',
                },
            };
        },
    });

    assert.equal(fallbackQueries.length, 1);
    assert.equal(fallbackQueries[0].latitude, 0);
    assert.equal(fallbackQueries[0].longitude, 0);
    assert.equal(result.snapshot.quote.stationId, 'fallback-origin');
    assert.equal(result.snapshot.trajectory, undefined);
});
