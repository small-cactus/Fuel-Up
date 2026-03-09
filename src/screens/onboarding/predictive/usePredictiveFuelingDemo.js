import { useEffect, useMemo, useRef, useState } from 'react';

const {
    buildRouteMetrics,
    getDemoSnapshot,
} = require('./simulationMath.cjs');

function interpolateHeadingDegrees(startHeading, endHeading, progress) {
    const normalizedDelta = ((endHeading - startHeading + 540) % 360) - 180;
    return (startHeading + normalizedDelta * progress + 360) % 360;
}

function smoothCamera(previousCamera, nextCamera, sceneConfig, deltaMs) {
    if (!nextCamera) {
        return null;
    }

    if (!previousCamera) {
        return nextCamera;
    }

    const smoothing = sceneConfig.cameraSmoothing;
    const deltaScale = Math.max(0.35, Math.min(2, deltaMs / 16.67));
    const centerAlpha = 1 - Math.pow(1 - smoothing.center, deltaScale);
    const headingAlpha = 1 - Math.pow(1 - smoothing.heading, deltaScale);
    const altitudeAlpha = 1 - Math.pow(1 - smoothing.altitude, deltaScale);
    const pitchAlpha = 1 - Math.pow(1 - smoothing.pitch, deltaScale);

    return {
        center: {
            latitude: previousCamera.center.latitude + (
                nextCamera.center.latitude - previousCamera.center.latitude
            ) * centerAlpha,
            longitude: previousCamera.center.longitude + (
                nextCamera.center.longitude - previousCamera.center.longitude
            ) * centerAlpha,
        },
        heading: interpolateHeadingDegrees(
            previousCamera.heading,
            nextCamera.heading,
            headingAlpha
        ),
        altitude: previousCamera.altitude + (
            nextCamera.altitude - previousCamera.altitude
        ) * altitudeAlpha,
        pitch: previousCamera.pitch + (
            nextCamera.pitch - previousCamera.pitch
        ) * pitchAlpha,
    };
}

export default function usePredictiveFuelingDemo({ isActive, route, sceneConfig }) {
    const routeMetrics = useMemo(() => {
        if (!route?.coordinates?.length) {
            return null;
        }

        return buildRouteMetrics(route, sceneConfig);
    }, [route, sceneConfig]);

    const [elapsedMs, setElapsedMs] = useState(0);
    const lastFrameRef = useRef({
        activeCamera: null,
        elapsedMs: 0,
    });

    useEffect(() => {
        if (!routeMetrics) {
            setElapsedMs(0);
            lastFrameRef.current = {
                activeCamera: null,
                elapsedMs: 0,
            };
            return undefined;
        }

        if (!isActive) {
            setElapsedMs(0);
            lastFrameRef.current = {
                activeCamera: null,
                elapsedMs: 0,
            };
            return undefined;
        }

        let animationFrameId = null;
        let startedAtMs = 0;

        const tick = timestampMs => {
            if (!startedAtMs) {
                startedAtMs = timestampMs;
            }

            setElapsedMs(timestampMs - startedAtMs);
            animationFrameId = requestAnimationFrame(tick);
        };

        animationFrameId = requestAnimationFrame(tick);

        return () => {
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [
        isActive,
        routeMetrics,
        sceneConfig.loopDurationMs,
    ]);

    return useMemo(() => {
        if (!routeMetrics) {
            return {
                activeCamera: null,
                arrivalOrbitProgress: 0,
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
        const arrivalElapsedMs = Math.max(0, elapsedMs - sceneConfig.loopDurationMs);
        const snapshot = getDemoSnapshot(routeMetrics, sceneConfig, normalizedProgress, arrivalElapsedMs);
        const deltaMs = Math.max(16.67, elapsedMs - lastFrameRef.current.elapsedMs);
        const smoothedCamera = smoothCamera(
            lastFrameRef.current.activeCamera,
            snapshot.activeCamera,
            sceneConfig,
            deltaMs
        );

        lastFrameRef.current = {
            activeCamera: smoothedCamera,
            elapsedMs,
        };

        return {
            ...snapshot,
            activeCamera: smoothedCamera,
            routeMetrics,
        };
    }, [elapsedMs, routeMetrics, sceneConfig]);
}
