const test = require('node:test');
const assert = require('node:assert/strict');

const {
    recommend,
} = require('../src/lib/predictiveRecommender.js');
const {
    createPredictiveLocationPrefetchController,
} = require('../src/lib/predictiveLocationPrefetchController.js');
const {
    refreshFuelPriceSnapshotAlongTrajectory,
} = require('../src/services/fuel');

function createStationQuote({
    stationId,
    latitude,
    longitude,
    price,
    brand = 'Test',
    distanceMiles = 1,
}) {
    return {
        providerId: 'gasbuddy',
        providerTier: 'station',
        stationId,
        stationName: brand,
        address: `${brand} Address`,
        latitude,
        longitude,
        fuelType: 'regular',
        price,
        distanceMiles,
        isEstimated: false,
        brand,
        sourceLabel: 'GasBuddy',
        fetchedAt: '2026-04-14T12:00:00.000Z',
    };
}

function buildEastboundWindow({ timestampMs, includeStopNoise = false, speedMps = 16 }) {
    const window = [
        { latitude: 0, longitude: 0.00, speed: speedMps, timestamp: timestampMs - 20_000 },
        { latitude: 0, longitude: 0.01, speed: speedMps, timestamp: timestampMs - 15_000 },
        { latitude: 0, longitude: 0.02, speed: speedMps, timestamp: timestampMs - 10_000 },
        { latitude: 0, longitude: 0.03, speed: speedMps, timestamp: timestampMs - 5_000 },
        { latitude: 0, longitude: 0.04, speed: speedMps, timestamp: timestampMs },
    ];

    if (!includeStopNoise) {
        return window;
    }

    return [
        window[0],
        { latitude: 0, longitude: 0.012, speed: 0.3, timestamp: timestampMs - 14_000, eventType: 'stop_sign' },
        window[1],
        { latitude: 0, longitude: 0.024, speed: 0.6, timestamp: timestampMs - 9_000, eventType: 'traffic_light' },
        window[2],
        window[3],
        window[4],
    ];
}

function buildExtendedEastboundWindow({ timestampMs, speedMps = 16 }) {
    return [
        { latitude: 0, longitude: -0.02, speed: speedMps, timestamp: timestampMs - 35_000 },
        { latitude: 0, longitude: -0.01, speed: speedMps, timestamp: timestampMs - 30_000 },
        { latitude: 0, longitude: 0.00, speed: speedMps, timestamp: timestampMs - 25_000 },
        { latitude: 0, longitude: 0.01, speed: speedMps, timestamp: timestampMs - 20_000 },
        { latitude: 0, longitude: 0.02, speed: speedMps, timestamp: timestampMs - 15_000 },
        { latitude: 0, longitude: 0.03, speed: speedMps, timestamp: timestampMs - 10_000 },
        { latitude: 0, longitude: 0.04, speed: speedMps, timestamp: timestampMs - 5_000 },
        { latitude: 0, longitude: 0.05, speed: speedMps, timestamp: timestampMs },
    ];
}

function createSnapshotFetcher({ originStations, aheadStations }) {
    return async (query) => {
        const stations = Number(query.longitude) < 0.05
            ? originStations
            : aheadStations;
        const quote = stations[0] || null;
        return {
            debugState: {
                providers: [{ providerId: 'gasbuddy', providerTier: 'station', enabled: true }],
            },
            snapshot: {
                quote,
                topStations: stations,
                regionalQuotes: [],
                fetchedAt: '2026-04-14T12:00:00.000Z',
            },
        };
    };
}

function createRouteProvider({
    distanceMeters = 17_000,
    coordinates = [
        { latitude: 0, longitude: 0.00 },
        { latitude: 0, longitude: 0.06 },
        { latitude: 0, longitude: 0.12 },
        { latitude: 0, longitude: 0.16 },
    ],
}) {
    return async () => ({
        distanceMeters,
        coordinates,
        steps: [
            { instructions: 'Stay on the route' },
            { instructions: 'Continue straight' },
        ],
    });
}

function habitVisit(stationId, timestampMs, visitCount = 5) {
    return {
        stationId,
        visitCount,
        lastVisitMs: timestampMs - 86_400_000,
        visitTimestamps: [
            timestampMs - 86_400_000,
            timestampMs - (3 * 86_400_000),
            timestampMs - (8 * 86_400_000),
        ],
        contextCounts: {
            total: visitCount,
            highway: 0,
            suburban: 0,
            city: visitCount,
            city_grid: 0,
            weekday: visitCount,
            weekend: 0,
            morning: visitCount,
            midday: 0,
            evening: 0,
            night: 0,
        },
    };
}

async function runIntegratedScenario({
    timestampMs,
    locationPayload,
    routeProvider,
    originStations,
    aheadStations,
    profile,
    urgency = 0.7,
    lookaheadMeters = 10_000,
    routeTargetMeters = 16_000,
    speedMps = 16,
    includeStopNoise = false,
    recommendationWindow = null,
    recommendationOptions = {},
}) {
    const snapshotFetcher = createSnapshotFetcher({ originStations, aheadStations });
    const cacheWrites = [];
    const controller = createPredictiveLocationPrefetchController({
        prefetchSnapshot: (input) => refreshFuelPriceSnapshotAlongTrajectory({
            ...input,
            lookaheadMeters,
            routeTargetMeters,
            routeProvider,
            snapshotFetcher,
            cacheWriter: async (key, value) => {
                cacheWrites.push({ key, value });
                return value;
            },
        }),
    });
    const prefetchResult = await controller.handleLocationPayload(locationPayload, {
        radiusMiles: 10,
        fuelType: 'regular',
        preferredProvider: 'gasbuddy',
    });

    const mergedStations = prefetchResult.result?.snapshot?.topStations || [];
    const recommendation = recommend(
        recommendationWindow || buildEastboundWindow({ timestampMs, includeStopNoise, speedMps }),
        profile,
        mergedStations,
        {
            triggerThreshold: 0.5,
            urgency,
            ...recommendationOptions,
        }
    );

    return {
        cacheWrites,
        mergedStations,
        prefetchResult,
        recommendation,
    };
}

test('predictive system matrix covers broad live scenarios and edge cases', async (t) => {
    await t.test('cold-start commuter prefers the cheaper ahead station before arrival', async () => {
        const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
        const result = await runIntegratedScenario({
            timestampMs,
            locationPayload: {
                locations: [
                    {
                        coords: {
                            latitude: 0,
                            longitude: 0,
                            course: 90,
                            speed: 16,
                        },
                    },
                ],
            },
            routeProvider: createRouteProvider({}),
            originStations: [
                createStationQuote({ stationId: 'origin-shell', latitude: 0, longitude: 0.015, price: 3.49, brand: 'Shell' }),
            ],
            aheadStations: [
                createStationQuote({ stationId: 'ahead-cheap-right', latitude: -0.0012, longitude: 0.09, price: 3.05, brand: 'King Soopers' }),
            ],
            profile: {
                preferredBrands: ['Shell'],
                brandLoyalty: 0.55,
                visitHistory: [],
                fillUpHistory: [],
            },
            urgency: 0.95,
            recommendationWindow: buildExtendedEastboundWindow({ timestampMs, speedMps: 18 }),
            recommendationOptions: {
                minTripFuelIntentColdStart: 0.2,
                coldStartThreshold: 0.2,
                minColdStartBranchTripFuelIntent: 0.2,
                minColdStartBranchLead: 0.06,
            },
        });

        assert.equal(result.prefetchResult.queued, true);
        assert.equal(result.prefetchResult.result.snapshot.quote.stationId, 'ahead-cheap-right');
        assert.equal(result.recommendation.stationId, 'ahead-cheap-right');
        assert.ok(result.recommendation.forwardDistance >= 1_500);
        assert.equal(result.cacheWrites.length, 1);
    });

    await t.test('rush-hour cost logic rejects a slightly cheaper hard left in favor of an easier right-side stop', async () => {
        const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
        const result = await runIntegratedScenario({
            timestampMs,
            locationPayload: {
                locations: [
                    {
                        coords: {
                            latitude: 0,
                            longitude: 0,
                            course: 90,
                            speed: 14,
                        },
                    },
                ],
            },
            routeProvider: createRouteProvider({}),
            originStations: [
                createStationQuote({ stationId: 'habit-shell', latitude: 0, longitude: 0.10, price: 3.59, brand: 'Shell' }),
            ],
            aheadStations: [
                createStationQuote({ stationId: 'hard-left-cheap', latitude: 0.0014, longitude: 0.09, price: 3.19, brand: 'Budget' }),
                createStationQuote({ stationId: 'easy-right-near-cheap', latitude: -0.0011, longitude: 0.092, price: 3.22, brand: 'King Soopers' }),
            ],
            profile: {
                preferredBrands: ['Shell'],
                brandLoyalty: 0.6,
                visitHistory: [habitVisit('habit-shell', timestampMs)],
                fillUpHistory: [],
            },
            urgency: 0.95,
            recommendationOptions: {
                minTripFuelIntentColdStart: 0.2,
                minTripFuelIntentWithHistory: 0.2,
            },
        });

        assert.equal(result.recommendation.stationId, 'easy-right-near-cheap');
        assert.equal(result.recommendation.stationSide, 'right');
    });

    await t.test('attention semantics defer during active driving and surface at a traffic light', async () => {
        const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
        const profile = {
            preferredBrands: ['Shell'],
            brandLoyalty: 0.6,
            visitHistory: [habitVisit('habit-shell', timestampMs)],
            fillUpHistory: [],
        };
        const baseParams = {
            routeProvider: createRouteProvider({}),
            originStations: [
                createStationQuote({ stationId: 'habit-shell', latitude: 0, longitude: 0.10, price: 3.59, brand: 'Shell' }),
            ],
            aheadStations: [
                createStationQuote({ stationId: 'easy-right-near-cheap', latitude: -0.0011, longitude: 0.092, price: 3.22, brand: 'King Soopers' }),
            ],
            profile,
        };

        const moving = await runIntegratedScenario({
            ...baseParams,
            timestampMs,
            urgency: 0.95,
            recommendationOptions: {
                minTripFuelIntentColdStart: 0.2,
                minTripFuelIntentWithHistory: 0.2,
            },
            locationPayload: {
                locations: [
                    { coords: { latitude: 0, longitude: 0, course: 90, speed: 14 } },
                ],
            },
        });
        assert.equal(moving.recommendation.presentation.surfaceNow, false);

        const stopped = recommend(
            [
                { latitude: 0, longitude: 0.00, speed: 14, timestamp: timestampMs - 210_000 },
                { latitude: 0, longitude: 0.02, speed: 14, timestamp: timestampMs - 180_000 },
                { latitude: 0, longitude: 0.04, speed: 14, timestamp: timestampMs - 150_000 },
                { latitude: 0, longitude: 0.06, speed: 14, timestamp: timestampMs - 120_000 },
                { latitude: 0, longitude: 0.08, speed: 14, timestamp: timestampMs - 90_000 },
                { latitude: 0, longitude: 0.085, speed: 0.7, timestamp: timestampMs - 8_000 },
                { latitude: 0, longitude: 0.0851, speed: 0.2, timestamp: timestampMs - 4_000, eventType: 'traffic_light' },
                { latitude: 0, longitude: 0.0851, speed: 0.1, timestamp: timestampMs, eventType: 'traffic_light' },
            ],
            profile,
            moving.mergedStations,
            {
                triggerThreshold: 0.5,
                urgency: 0.95,
                minTripFuelIntentColdStart: 0.2,
                minTripFuelIntentWithHistory: 0.2,
            }
        );

        assert.ok(stopped);
        assert.equal(stopped.presentation.surfaceNow, true);
        assert.equal(stopped.presentation.attentionState, 'traffic_light_pause');
    });

    await t.test('off-peak savings can justify the harder left-side move', async () => {
        const timestampMs = new Date('2026-04-14T13:30:00-04:00').getTime();
        const result = await runIntegratedScenario({
            timestampMs,
            locationPayload: {
                locations: [
                    {
                        coords: {
                            latitude: 0,
                            longitude: 0,
                            course: 90,
                            speed: 14,
                        },
                    },
                ],
            },
            routeProvider: createRouteProvider({}),
            originStations: [
                createStationQuote({ stationId: 'habit-shell', latitude: 0, longitude: 0.10, price: 3.59, brand: 'Shell' }),
            ],
            aheadStations: [
                createStationQuote({ stationId: 'hard-left-very-cheap', latitude: 0.0014, longitude: 0.09, price: 2.79, brand: 'Budget' }),
                createStationQuote({ stationId: 'easy-right-less-cheap', latitude: -0.0011, longitude: 0.092, price: 3.18, brand: 'King Soopers' }),
            ],
            profile: {
                preferredBrands: ['Shell'],
                brandLoyalty: 0.6,
                visitHistory: [habitVisit('habit-shell', timestampMs)],
                fillUpHistory: [],
            },
            urgency: 0.95,
            recommendationOptions: {
                minTripFuelIntentColdStart: 0.2,
                minTripFuelIntentWithHistory: 0.2,
            },
        });

        assert.equal(result.recommendation.stationId, 'hard-left-very-cheap');
    });

    await t.test('road-trip mode pushes the ahead fetch deeper into the route and still recommends early', async () => {
        const timestampMs = new Date('2026-04-18T10:30:00-04:00').getTime();
        const result = await runIntegratedScenario({
            timestampMs,
            locationPayload: {
                locations: [
                    {
                        coords: {
                            latitude: 0,
                            longitude: 0,
                            course: 90,
                            speed: 30,
                        },
                    },
                ],
            },
            routeProvider: createRouteProvider({
                distanceMeters: 25_000,
                coordinates: [
                    { latitude: 0, longitude: 0.00 },
                    { latitude: 0, longitude: 0.08 },
                    { latitude: 0, longitude: 0.16 },
                    { latitude: 0, longitude: 0.24 },
                ],
            }),
            originStations: [
                createStationQuote({ stationId: 'exit-1', latitude: 0, longitude: 0.11, price: 3.39, brand: 'Shell' }),
            ],
            aheadStations: [
                createStationQuote({ stationId: 'travel-center-cheap', latitude: -0.0008, longitude: 0.15, price: 3.01, brand: 'Love\'s' }),
            ],
            profile: {
                preferredBrands: [],
                brandLoyalty: 0,
                visitHistory: [],
                fillUpHistory: [],
            },
            urgency: 0.92,
            speedMps: 30,
        });

        assert.ok(result.prefetchResult.result.trajectoryPlan.lookaheadMeters >= 10_000);
        assert.equal(result.recommendation.stationId, 'travel-center-cheap');
        assert.ok(result.recommendation.forwardDistance >= 7_000);
    });

    await t.test('duplicate stations returned from current and ahead fetches are deduped into one merged station', async () => {
        const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
        const duplicate = createStationQuote({ stationId: 'same-station', latitude: -0.001, longitude: 0.08, price: 3.12, brand: 'Costco' });
        const result = await runIntegratedScenario({
            timestampMs,
            locationPayload: {
                locations: [
                    {
                        coords: {
                            latitude: 0,
                            longitude: 0,
                            course: 90,
                            speed: 15,
                        },
                    },
                ],
            },
            routeProvider: createRouteProvider({}),
            originStations: [duplicate],
            aheadStations: [duplicate],
            profile: {
                preferredBrands: [],
                brandLoyalty: 0,
                visitHistory: [],
                fillUpHistory: [],
            },
        });

        assert.equal(result.mergedStations.length, 1);
        assert.equal(result.mergedStations[0].stationId, 'same-station');
    });

    await t.test('stop-sign and traffic-light noise do not trigger background prefetch until movement resumes', async () => {
        const controllerCalls = [];
        const controller = createPredictiveLocationPrefetchController({
            prefetchSnapshot: async (input) => {
                controllerCalls.push(input);
                return { ok: true };
            },
        });

        const stopNoise = await controller.handleLocationPayload({
            locations: [
                { coords: { latitude: 0, longitude: 0, course: 90, speed: 0.4 }, eventType: 'stop_sign' },
                { coords: { latitude: 0, longitude: 0.001, course: 90, speed: 0.6 }, eventType: 'traffic_light' },
            ],
        }, {
            radiusMiles: 10,
            fuelType: 'regular',
            preferredProvider: 'gasbuddy',
        });
        const moving = await controller.handleLocationPayload({
            locations: [
                { coords: { latitude: 0, longitude: 0.002, course: 90, speed: 12 } },
            ],
        }, {
            radiusMiles: 10,
            fuelType: 'regular',
            preferredProvider: 'gasbuddy',
        });

        assert.equal(stopNoise.queued, false);
        assert.equal(moving.queued, true);
        assert.equal(controllerCalls.length, 1);
    });

    await t.test('missing trajectory data is ignored instead of forcing a bad fetch', async () => {
        const controller = createPredictiveLocationPrefetchController({
            prefetchSnapshot: async () => {
                throw new Error('should not be called');
            },
        });

        const result = await controller.handleLocationPayload({
            locations: [
                {
                    coords: {
                        latitude: 37.3346,
                        longitude: -122.009,
                        speed: 12,
                    },
                },
            ],
        }, {
            radiusMiles: 10,
            fuelType: 'regular',
            preferredProvider: 'gasbuddy',
        });

        assert.equal(result.queued, false);
        assert.equal(result.reason, 'missing-trajectory');
    });

    await t.test('MapKit route failures fail closed with no geometry fallback path', async () => {
        await assert.rejects(
            runIntegratedScenario({
                timestampMs: new Date('2026-04-14T08:30:00-04:00').getTime(),
                locationPayload: {
                    locations: [
                        {
                            coords: {
                                latitude: 0,
                                longitude: 0,
                                course: 90,
                                speed: 16,
                            },
                        },
                    ],
                },
                routeProvider: async () => ({ coordinates: [] }),
                originStations: [
                    createStationQuote({ stationId: 'origin-shell', latitude: 0, longitude: 0.015, price: 3.49, brand: 'Shell' }),
                ],
                aheadStations: [
                    createStationQuote({ stationId: 'ahead-cheap-right', latitude: -0.0012, longitude: 0.09, price: 3.05, brand: 'King Soopers' }),
                ],
                profile: {
                    preferredBrands: [],
                    brandLoyalty: 0,
                    visitHistory: [],
                    fillUpHistory: [],
                },
            }),
            /usable route polyline|trajectory fetch plan/i
        );
    });

    await t.test('background cooldown prevents repeated prefetch spam for the same live drive corridor', async () => {
        let nowMs = 1_700_000_000_000;
        let callCount = 0;
        const controller = createPredictiveLocationPrefetchController({
            now: () => nowMs,
            prefetchSnapshot: async () => {
                callCount += 1;
                return { ok: true };
            },
        });
        const payload = {
            locations: [
                {
                    coords: {
                        latitude: 0,
                        longitude: 0,
                        course: 90,
                        speed: 16,
                    },
                },
            ],
        };
        const settings = {
            radiusMiles: 10,
            fuelType: 'regular',
            preferredProvider: 'gasbuddy',
        };

        const first = await controller.handleLocationPayload(payload, settings);
        const second = await controller.handleLocationPayload(payload, settings);
        nowMs += 90_001;
        const third = await controller.handleLocationPayload(payload, settings);

        assert.equal(first.queued, true);
        assert.equal(second.queued, false);
        assert.equal(third.queued, true);
        assert.equal(callCount, 2);
    });
});
