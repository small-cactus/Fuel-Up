const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAdaptiveHiddenIntentStressRoutes } = require('../src/lib/fuelerSimulation.js');

for (const historyLevel of ['none', 'light', 'rich']) {
    test(`adaptive ${historyLevel} routes branch on the selected route's own waypoint range`, () => {
        for (const seed of [2026, 3101, 3102, 3103, 3104, 3105, 4101]) {
            const routes = buildAdaptiveHiddenIntentStressRoutes({ seed, routeCount: 96, historyLevel });
            assert.equal(routes.length, 96);
            for (const route of routes) {
                assert.ok(route.waypoints.every(point => Number.isFinite(point.lat) && Number.isFinite(point.lon)));
                if (route.willStop) {
                    assert.ok(route.hiddenDecisionIndex >= 0 && route.hiddenDecisionIndex < route.waypoints.length);
                    assert.ok(route.actualFuelStopStationId);
                }
            }
        }
    });
}
