const test = require('node:test');
const assert = require('node:assert/strict');

const {
    annotateStationWithRouteContext,
    buildTrajectorySeedFromLocationObject,
    buildTrajectorySeedFromLocationSeries,
    resolveTrajectoryFetchPlanAsync,
} = require('../src/lib/trajectoryFuelFetch');

test('buildTrajectorySeedFromLocationObject extracts course and speed from a location payload', () => {
    const trajectorySeed = buildTrajectorySeedFromLocationObject({
        coords: {
            latitude: 37.3346,
            longitude: -122.009,
            course: 82,
            speed: 19.4,
        },
    });

    assert.deepEqual(trajectorySeed, {
        latitude: 37.3346,
        longitude: -122.009,
        courseDegrees: 82,
        speedMps: 19.4,
    });
});

test('buildTrajectorySeedFromLocationSeries derives heading from location displacement when course is missing', () => {
    const trajectorySeed = buildTrajectorySeedFromLocationSeries([
        {
            coords: {
                latitude: 37.3346,
                longitude: -122.02,
                speed: 12,
                timestamp: 1_700_000_000_000,
            },
        },
        {
            coords: {
                latitude: 37.3346,
                longitude: -122.018,
                speed: 12,
                timestamp: 1_700_000_005_000,
            },
        },
        {
            coords: {
                latitude: 37.3346,
                longitude: -122.016,
                speed: 12,
                timestamp: 1_700_000_010_000,
            },
        },
    ]);

    assert.ok(trajectorySeed, 'expected a derived trajectory seed');
    assert.ok(trajectorySeed.courseDegrees > 80 && trajectorySeed.courseDegrees < 100, `unexpected derived bearing ${trajectorySeed.courseDegrees}`);
});

test('resolveTrajectoryFetchPlanAsync uses the MapKit route polyline to place the ahead query point', async () => {
    const routeCalls = [];
    const routeProvider = async (payload) => {
        routeCalls.push(payload);
        return {
            distanceMeters: 13_350,
            coordinates: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: 0.04 },
                { latitude: 0, longitude: 0.08 },
                { latitude: 0, longitude: 0.12 },
            ],
            steps: [
                { instructions: 'Head east' },
                { instructions: 'Continue straight' },
            ],
        };
    };

    const plan = await resolveTrajectoryFetchPlanAsync({
        latitude: 0,
        longitude: 0,
        courseDegrees: 90,
        speedMps: 22,
        lookaheadMeters: 6_000,
        routeTargetMeters: 12_000,
        routeProvider,
    });

    assert.equal(routeCalls.length, 1);
    assert.equal(plan.queryPoints.length, 2);
    assert.ok(plan.lookaheadMeters >= 6_000);
    assert.ok(plan.projectedDestination.longitude > 0);
    assert.ok(plan.aheadPoint.longitude > 0.05 && plan.aheadPoint.longitude < 0.06, `unexpected ahead longitude ${plan.aheadPoint.longitude}`);
});

test('resolveTrajectoryFetchPlanAsync fails closed when MapKit does not return a usable polyline', async () => {
    await assert.rejects(
        resolveTrajectoryFetchPlanAsync({
            latitude: 37.3346,
            longitude: -122.009,
            courseDegrees: 90,
            speedMps: 18,
            routeProvider: async () => ({ coordinates: [] }),
        }),
        /usable route polyline/i
    );
});

test('annotateStationWithRouteContext uses real route steps to compute a maneuver penalty and side of road', () => {
    const station = annotateStationWithRouteContext({
        origin: { latitude: 0, longitude: 0 },
        station: {
            stationId: 'left-stop',
            latitude: 0.0012,
            longitude: 0.09,
            price: 3.19,
        },
        route: {
            coordinates: [
                { latitude: 0, longitude: 0.00 },
                { latitude: 0, longitude: 0.06 },
                { latitude: 0, longitude: 0.12 },
            ],
            steps: [
                { instructions: 'Continue straight', distanceMeters: 9000 },
                { instructions: 'Turn left', distanceMeters: 4500 },
            ],
        },
    });

    assert.equal(station.routeApproach.sideOfRoad, 'left');
    assert.ok(station.routeApproach.maneuverPenaltyPrice >= 0.12);
    assert.ok(station.effectivePrice > station.price);
});
