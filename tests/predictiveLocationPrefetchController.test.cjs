const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createPredictiveLocationPrefetchController,
} = require('../src/lib/predictiveLocationPrefetchController');

test('predictive location prefetch controller ignores low-speed stoplight samples', async () => {
    let callCount = 0;
    const controller = createPredictiveLocationPrefetchController({
        prefetchSnapshot: async () => {
            callCount += 1;
        },
    });

    const result = await controller.handleLocationPayload({
        locations: [
            {
                coords: {
                    latitude: 37.3346,
                    longitude: -122.009,
                    course: 90,
                    speed: 0.4,
                },
            },
        ],
    }, {
        radiusMiles: 10,
        fuelType: 'regular',
        preferredProvider: 'gasbuddy',
    });

    assert.equal(result.queued, false);
    assert.equal(result.reason, 'below-speed-threshold');
    assert.equal(callCount, 0);
});

test('predictive location prefetch controller triggers a trajectory prefetch for moving samples', async () => {
    const calls = [];
    const controller = createPredictiveLocationPrefetchController({
        prefetchSnapshot: async (input) => {
            calls.push(input);
            return { ok: true };
        },
    });

    const result = await controller.handleLocationPayload({
        locations: [
            {
                coords: {
                    latitude: 37.3346,
                    longitude: -122.009,
                    course: 91,
                    speed: 14.2,
                },
            },
        ],
    }, {
        radiusMiles: 12,
        fuelType: 'premium',
        preferredProvider: 'all',
    });

    assert.equal(result.queued, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].courseDegrees, 91);
    assert.equal(calls[0].speedMps, 14.2);
    assert.equal(calls[0].radiusMiles, 12);
    assert.equal(calls[0].fuelType, 'premium');
    assert.equal(calls[0].preferredProvider, 'all');
});

test('predictive location prefetch controller respects its cooldown window', async () => {
    let nowMs = 1_700_000_000_000;
    let callCount = 0;
    const controller = createPredictiveLocationPrefetchController({
        now: () => nowMs,
        cooldownMs: 90_000,
        prefetchSnapshot: async () => {
            callCount += 1;
            return { ok: true };
        },
    });
    const payload = {
        locations: [
            {
                coords: {
                    latitude: 37.3346,
                    longitude: -122.009,
                    course: 88,
                    speed: 12.5,
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
    assert.equal(second.reason, 'cooldown');
    assert.equal(third.queued, true);
    assert.equal(callCount, 2);
});
