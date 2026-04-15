import * as FileSystem from 'expo-file-system/legacy';
import { getDrivingRouteAsync } from './FuelUpMapKitRouting';

const {
    createPredictiveLocationPrefetchController,
} = require('./predictiveLocationPrefetchController.js');
const {
    refreshFuelPriceSnapshotAlongTrajectory,
} = require('../services/fuel/index.js');
const {
    annotateStationWithRouteContext,
    buildTrajectorySeedFromLocationSeries,
    calculateDistanceMeters,
    getCoordinateAlongPolyline,
    resolveTrajectoryFetchPlanAsync,
} = require('./trajectoryFuelFetch.js');
const {
    recommend,
} = require('./predictiveRecommender.js');

const PROBE_REPORT_FILE_NAME = 'predictive-system-probe.json';

function getReportUri() {
    if (!FileSystem.documentDirectory) {
        return null;
    }

    return `${FileSystem.documentDirectory}${PROBE_REPORT_FILE_NAME}`;
}

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function toDegrees(value) {
    return (value * 180) / Math.PI;
}

function calculateBearingDegrees(origin, target) {
    const latitudeA = toRadians(origin.latitude);
    const latitudeB = toRadians(target.latitude);
    const longitudeDelta = toRadians(target.longitude - origin.longitude);
    const y = Math.sin(longitudeDelta) * Math.cos(latitudeB);
    const x = Math.cos(latitudeA) * Math.sin(latitudeB) -
        Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta);

    return ((toDegrees(Math.atan2(y, x)) % 360) + 360) % 360;
}

function projectCoordinate({ latitude, longitude, bearingDegrees, distanceMeters }) {
    const earthRadiusMeters = 6_371_000;
    const angularDistance = distanceMeters / earthRadiusMeters;
    const bearingRadians = toRadians(bearingDegrees);
    const latitudeRadians = toRadians(latitude);
    const longitudeRadians = toRadians(longitude);
    const projectedLatitude = Math.asin(
        Math.sin(latitudeRadians) * Math.cos(angularDistance) +
        Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians)
    );
    const projectedLongitude = longitudeRadians + Math.atan2(
        Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
        Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(projectedLatitude)
    );

    return {
        latitude: toDegrees(projectedLatitude),
        longitude: toDegrees(projectedLongitude),
    };
}

function coordinateAtAlongDistance(routeCoordinates, alongDistanceMeters) {
    const clampedDistance = Math.max(0, alongDistanceMeters);
    const coordinate = getCoordinateAlongPolyline({
        coordinates: routeCoordinates,
        distanceMeters: clampedDistance,
    });
    const probeAhead = getCoordinateAlongPolyline({
        coordinates: routeCoordinates,
        distanceMeters: clampedDistance + 25,
    });
    const bearingDegrees = calculateBearingDegrees(coordinate, probeAhead);

    return { coordinate, bearingDegrees };
}

function offsetFromRoute(routeCoordinates, alongDistanceMeters, lateralOffsetMeters) {
    const { coordinate, bearingDegrees } = coordinateAtAlongDistance(routeCoordinates, alongDistanceMeters);
    const lateralBearing = (bearingDegrees + (lateralOffsetMeters >= 0 ? -90 : 90) + 360) % 360;

    return projectCoordinate({
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        bearingDegrees: lateralBearing,
        distanceMeters: Math.abs(lateralOffsetMeters),
    });
}

function createSyntheticStation({
    stationId,
    brand,
    price,
    routeCoordinates,
    alongDistanceMeters,
    lateralOffsetMeters,
}) {
    const coordinate = offsetFromRoute(routeCoordinates, alongDistanceMeters, lateralOffsetMeters);

    return {
        providerId: 'gasbuddy',
        providerTier: 'station',
        stationId,
        stationName: brand,
        address: `${brand} Synthetic`,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        fuelType: 'regular',
        price,
        distanceMiles: 1,
        isEstimated: false,
        brand,
        sourceLabel: 'Synthetic Probe',
        fetchedAt: new Date().toISOString(),
    };
}

function buildWindowFromRoute({ routeCoordinates, speedMps, timestampMs }) {
    const samples = [];
    const sampleDistances = [0, 160, 320, 520, 760];

    sampleDistances.forEach((distanceMeters, index) => {
        const coordinate = getCoordinateAlongPolyline({
            coordinates: routeCoordinates,
            distanceMeters,
        });
        samples.push({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            speed: speedMps,
            timestamp: timestampMs - ((sampleDistances.length - index - 1) * 4000),
        });
    });

  return samples;
}

function buildPresentationWindowFromRoute({
    routeCoordinates,
    speedMps,
    timestampMs,
    mode = 'moving',
    leadInSampleCount = 8,
}) {
    const baseSamples = [];
    const distanceStep = mode === 'highway_glance' ? 900 : 520;
    for (let index = 0; index < leadInSampleCount; index += 1) {
        const coordinate = getCoordinateAlongPolyline({
            coordinates: routeCoordinates,
            distanceMeters: index * distanceStep,
        });
        baseSamples.push({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            speed: speedMps,
            timestamp: timestampMs - ((leadInSampleCount - index) * 30_000),
        });
    }

    if (mode === 'traffic_light_pause') {
        const stopCoordinate = getCoordinateAlongPolyline({
            coordinates: routeCoordinates,
            distanceMeters: (leadInSampleCount * distanceStep) + 120,
        });
        return [
            ...baseSamples,
            {
                latitude: stopCoordinate.latitude,
                longitude: stopCoordinate.longitude,
                speed: 0.8,
                timestamp: timestampMs - 9_000,
            },
            {
                latitude: stopCoordinate.latitude,
                longitude: stopCoordinate.longitude,
                speed: 0.2,
                timestamp: timestampMs - 4_000,
                eventType: 'traffic_light',
            },
            {
                latitude: stopCoordinate.latitude,
                longitude: stopCoordinate.longitude,
                speed: 0.1,
                timestamp: timestampMs,
                eventType: 'traffic_light',
            },
        ];
    }

    return baseSamples;
}

function createSnapshotFetcher({ seedCoordinate, aheadPoint, originStations, aheadStations }) {
    return async (query) => {
        const queryCoordinate = { latitude: query.latitude, longitude: query.longitude };
        const originDistance = calculateDistanceMeters(seedCoordinate, queryCoordinate);
        const aheadDistance = calculateDistanceMeters(aheadPoint, queryCoordinate);
        const useOriginStations = originDistance <= aheadDistance;
        const stations = useOriginStations ? originStations : aheadStations;

        return {
            debugState: {
                providers: [{ providerId: 'synthetic-probe', providerTier: 'station', enabled: true }],
            },
            snapshot: {
                quote: stations[0] || null,
                topStations: stations,
                regionalQuotes: [],
                fetchedAt: new Date().toISOString(),
            },
        };
    };
}

async function runProbeScenarioAsync({
    name,
    seed,
    profile,
    urgency,
    stationsBuilder,
    presentationMode = 'moving',
    expectedSurfaceNow = false,
}) {
    const trajectoryPlan = await resolveTrajectoryFetchPlanAsync({
        latitude: seed.latitude,
        longitude: seed.longitude,
        courseDegrees: seed.courseDegrees,
        speedMps: seed.speedMps,
        routeProvider: getDrivingRouteAsync,
    });
    const routeCoordinates = trajectoryPlan.route.coordinates;
    const stationSet = stationsBuilder(routeCoordinates);
    const snapshotFetcher = createSnapshotFetcher({
        seedCoordinate: { latitude: seed.latitude, longitude: seed.longitude },
        aheadPoint: trajectoryPlan.aheadPoint,
        originStations: stationSet.originStations,
        aheadStations: stationSet.aheadStations,
    });
    const controller = createPredictiveLocationPrefetchController({
        prefetchSnapshot: (input) => refreshFuelPriceSnapshotAlongTrajectory({
            ...input,
            routeProvider: getDrivingRouteAsync,
            snapshotFetcher,
            cacheWriter: async (_key, value) => value,
        }),
    });
    const locationPayload = {
        locations: [
            {
                coords: {
                    latitude: seed.latitude,
                    longitude: seed.longitude,
                    course: seed.courseDegrees,
                    speed: seed.speedMps,
                    timestamp: Date.now(),
                },
            },
        ],
    };
    const prefetchResult = await controller.handleLocationPayload(locationPayload, {
        radiusMiles: 10,
        fuelType: 'regular',
        preferredProvider: 'gasbuddy',
    });
    const mergedStations = prefetchResult?.result?.snapshot?.topStations || [];
    const window = buildPresentationWindowFromRoute({
        routeCoordinates,
        speedMps: seed.speedMps,
        timestampMs: Date.now(),
        mode: presentationMode,
    });
    const recommendation = recommend(window, profile, mergedStations, {
        urgency,
        triggerThreshold: 0.5,
    });

    return {
        name,
        pass: recommendation?.stationId === stationSet.expectedStationId,
        expectedStationId: stationSet.expectedStationId,
        recommendation: recommendation || null,
        routeStepCount: Array.isArray(trajectoryPlan.route.steps) ? trajectoryPlan.route.steps.length : 0,
        lookaheadMeters: trajectoryPlan.lookaheadMeters,
        presentationMode,
        expectedSurfaceNow,
        surfaceNow: Boolean(recommendation?.presentation?.surfaceNow),
        attentionState: recommendation?.presentation?.attentionState || null,
        noticeabilityScore: recommendation?.presentation?.noticeabilityScore || null,
        mergedStations: mergedStations.map(station => ({
            stationId: station.stationId,
            price: station.price,
            effectivePrice: station.effectivePrice,
            sideOfRoad: station.routeApproach?.sideOfRoad || null,
            maneuverPenaltyPrice: station.routeApproach?.maneuverPenaltyPrice || 0,
            nextStepDirections: station.routeApproach?.nextStepDirections || [],
        })),
    };
}

export async function runPredictiveSystemProbeAsync({ token = 'default' } = {}) {
    const reportUri = getReportUri();
    const scenarios = [
        {
            name: 'cold-start-cheaper-right',
            seed: {
                latitude: 37.7931,
                longitude: -122.3959,
                courseDegrees: 215,
                speedMps: 16,
            },
            profile: {
                preferredBrands: ['Shell'],
                brandLoyalty: 0.55,
                visitHistory: [],
                fillUpHistory: [],
            },
            urgency: 0.72,
            presentationMode: 'moving',
            expectedSurfaceNow: false,
            stationsBuilder(routeCoordinates) {
                return {
                    originStations: [
                        createSyntheticStation({
                            stationId: 'probe-origin-shell',
                            brand: 'Shell',
                            price: 3.59,
                            routeCoordinates,
                            alongDistanceMeters: 7_500,
                            lateralOffsetMeters: -50,
                        }),
                    ],
                    aheadStations: [
                        createSyntheticStation({
                            stationId: 'probe-ahead-right',
                            brand: 'King Soopers',
                            price: 3.09,
                            routeCoordinates,
                            alongDistanceMeters: 5_600,
                            lateralOffsetMeters: -45,
                        }),
                    ],
                    expectedStationId: 'probe-ahead-right',
                };
            },
        },
        {
            name: 'rush-hour-easy-right-wins',
            seed: {
                latitude: 37.7931,
                longitude: -122.3959,
                courseDegrees: 215,
                speedMps: 14,
            },
            profile: {
                preferredBrands: ['Shell'],
                brandLoyalty: 0.6,
                visitHistory: [{ stationId: 'probe-habit-shell', visitCount: 5, lastVisitMs: Date.now() - 86_400_000, visitTimestamps: [Date.now() - 86_400_000] }],
                fillUpHistory: [],
            },
            urgency: 0.8,
            presentationMode: 'traffic_light_pause',
            expectedSurfaceNow: true,
            stationsBuilder(routeCoordinates) {
                return {
                    originStations: [
                        createSyntheticStation({
                            stationId: 'probe-habit-shell',
                            brand: 'Shell',
                            price: 3.59,
                            routeCoordinates,
                            alongDistanceMeters: 8_800,
                            lateralOffsetMeters: -55,
                        }),
                    ],
                    aheadStations: [
                        createSyntheticStation({
                            stationId: 'probe-hard-left',
                            brand: 'Budget',
                            price: 3.19,
                            routeCoordinates,
                            alongDistanceMeters: 5_800,
                            lateralOffsetMeters: 70,
                        }),
                        createSyntheticStation({
                            stationId: 'probe-easy-right',
                            brand: 'King Soopers',
                            price: 3.22,
                            routeCoordinates,
                            alongDistanceMeters: 5_950,
                            lateralOffsetMeters: -45,
                        }),
                    ],
                    expectedStationId: 'probe-easy-right',
                };
            },
        },
        {
            name: 'road-trip-early-stop',
            seed: {
                latitude: 37.8044,
                longitude: -122.2712,
                courseDegrees: 100,
                speedMps: 28,
            },
            profile: {
                preferredBrands: [],
                brandLoyalty: 0,
                visitHistory: [],
                fillUpHistory: [],
            },
            urgency: 0.92,
            presentationMode: 'highway_glance',
            expectedSurfaceNow: false,
            stationsBuilder(routeCoordinates) {
                return {
                    originStations: [
                        createSyntheticStation({
                            stationId: 'probe-roadtrip-default',
                            brand: 'Shell',
                            price: 3.39,
                            routeCoordinates,
                            alongDistanceMeters: 12_500,
                            lateralOffsetMeters: -55,
                        }),
                    ],
                    aheadStations: [
                        createSyntheticStation({
                            stationId: 'probe-roadtrip-cheap',
                            brand: 'Love\'s',
                            price: 3.01,
                            routeCoordinates,
                            alongDistanceMeters: 9_500,
                            lateralOffsetMeters: -50,
                        }),
                    ],
                    expectedStationId: 'probe-roadtrip-cheap',
                };
            },
        },
    ];

    const scenarioReports = [];
    let status = 'completed';
    let errorMessage = null;

    try {
        for (const scenario of scenarios) {
            // Rush-hour scenario needs a local wall-clock morning window.
            if (scenario.name === 'rush-hour-easy-right-wins') {
                const originalDateNow = Date.now;
                Date.now = () => new Date('2026-04-14T08:30:00-04:00').getTime();
                try {
                    scenarioReports.push(await runProbeScenarioAsync(scenario));
                } finally {
                    Date.now = originalDateNow;
                }
            } else {
                scenarioReports.push(await runProbeScenarioAsync(scenario));
            }
        }
    } catch (error) {
        status = 'failed';
        errorMessage = error?.message || String(error);
    }

    const report = {
        status,
        token,
        generatedAt: new Date().toISOString(),
        scenarioCount: scenarios.length,
        passedScenarioCount: scenarioReports.filter(entry => entry.pass).length,
        scenarios: scenarioReports,
        errorMessage,
    };

    if (reportUri) {
        await FileSystem.writeAsStringAsync(reportUri, JSON.stringify(report, null, 2));
    }

    return report;
}

export function getPredictiveSystemProbeReportFilename() {
    return PROBE_REPORT_FILE_NAME;
}
