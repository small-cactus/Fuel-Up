import { useEffect, useMemo, useState } from 'react';

const {
    buildRouteMetrics,
    getDemoSnapshot,
} = require('./simulationMath.cjs');

export default function usePredictiveFuelingDemo({ isActive, route, sceneConfig }) {
    const routeMetrics = useMemo(() => {
        if (!route?.coordinates?.length) {
            return null;
        }

        return buildRouteMetrics(route, sceneConfig);
    }, [route, sceneConfig]);

    const [elapsedMs, setElapsedMs] = useState(0);

    useEffect(() => {
        if (!routeMetrics) {
            setElapsedMs(0);
            return undefined;
        }

        if (!isActive) {
            setElapsedMs(0);
            return undefined;
        }

        const cycleDurationMs = sceneConfig.loopDurationMs + sceneConfig.loopHoldDurationMs;
        const startedAt = Date.now();
        const intervalId = setInterval(() => {
            setElapsedMs((Date.now() - startedAt) % cycleDurationMs);
        }, sceneConfig.frameIntervalMs);

        return () => {
            clearInterval(intervalId);
        };
    }, [
        isActive,
        routeMetrics,
        sceneConfig.frameIntervalMs,
        sceneConfig.loopDurationMs,
        sceneConfig.loopHoldDurationMs,
    ]);

    return useMemo(() => {
        if (!routeMetrics) {
            return {
                activeCamera: null,
                carCoordinate: null,
                heading: 0,
                narrative: null,
                passedStationState: 'default',
                progress: 0,
                remainingDistanceMeters: 0,
                routeMetrics: null,
                scenePhase: 'driving',
            };
        }

        const normalizedProgress = Math.min(elapsedMs / sceneConfig.loopDurationMs, 1);
        return {
            ...getDemoSnapshot(routeMetrics, sceneConfig, normalizedProgress),
            routeMetrics,
        };
    }, [elapsedMs, routeMetrics, sceneConfig]);
}
