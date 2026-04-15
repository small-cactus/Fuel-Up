const {
    MIN_PREFETCH_SPEED_MPS,
    buildTrajectorySeedFromLocationSeries,
} = require('./trajectoryFuelFetch');

function buildCooldownKey({
    latitude,
    longitude,
    courseDegrees,
    radiusMiles,
    fuelType,
    preferredProvider,
}) {
    return [
        Number(latitude).toFixed(3),
        Number(longitude).toFixed(3),
        Math.round(Number(courseDegrees) / 15),
        Math.round(Number(radiusMiles) || 10),
        String(fuelType || 'regular'),
        String(preferredProvider || 'gasbuddy'),
    ].join(':');
}

function createPredictiveLocationPrefetchController({
    prefetchSnapshot,
    cooldownMs = 90_000,
    minSpeedMps = MIN_PREFETCH_SPEED_MPS,
    now = () => Date.now(),
}) {
    let inflightPromise = null;
    let lastPrefetchAt = 0;
    let lastPrefetchKey = '';
    let lastTrajectorySeed = null;

    async function handleLocationPayload(payload, settings = {}) {
        const locations = Array.isArray(payload?.locations) ? payload.locations : [];
        const trajectorySeed = buildTrajectorySeedFromLocationSeries(locations, lastTrajectorySeed);

        if (!trajectorySeed) {
            return { queued: false, reason: 'missing-trajectory' };
        }

        lastTrajectorySeed = trajectorySeed;

        if (trajectorySeed.speedMps < minSpeedMps) {
            return { queued: false, reason: 'below-speed-threshold' };
        }

        if (typeof prefetchSnapshot !== 'function') {
            throw new Error('A trajectory prefetch function is required.');
        }

        if (inflightPromise) {
            return { queued: false, reason: 'in-flight' };
        }

        const prefetchKey = buildCooldownKey({
            ...trajectorySeed,
            radiusMiles: settings.radiusMiles,
            fuelType: settings.fuelType,
            preferredProvider: settings.preferredProvider,
        });
        const nowMs = now();
        const effectiveCooldownMs = Math.max(0, Number(settings.cooldownMs) || cooldownMs);

        if (prefetchKey === lastPrefetchKey && (nowMs - lastPrefetchAt) < effectiveCooldownMs) {
            return { queued: false, reason: 'cooldown' };
        }

        lastPrefetchAt = nowMs;
        lastPrefetchKey = prefetchKey;
        inflightPromise = Promise.resolve(prefetchSnapshot({
            ...settings,
            ...trajectorySeed,
        })).finally(() => {
            inflightPromise = null;
        });

        const result = await inflightPromise;
        return {
            queued: true,
            reason: 'prefetched',
            trajectorySeed,
            result,
        };
    }

    return {
        handleLocationPayload,
    };
}

module.exports = {
    createPredictiveLocationPrefetchController,
};
