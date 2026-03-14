import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Polyline, PROVIDER_APPLE } from 'react-native-maps';

import MockVehicleMarker from './MockVehicleMarker';
import RouteStationMarker from './RouteStationMarker';

const {
    getDemoSnapshot,
} = require('./simulationMath.cjs');

function createCameraSignature(camera) {
    if (!camera?.center) {
        return '';
    }

    return JSON.stringify({
        altitude: Number((camera.altitude || 0).toFixed(2)),
        heading: Number((camera.heading || 0).toFixed(2)),
        latitude: Number(camera.center.latitude.toFixed(6)),
        longitude: Number(camera.center.longitude.toFixed(6)),
        pitch: Number((camera.pitch || 0).toFixed(2)),
    });
}

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

function createRouteSignature(coordinates) {
    if (!coordinates?.length) {
        return 'empty';
    }

    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    return [
        coordinates.length,
        first.latitude.toFixed(5),
        first.longitude.toFixed(5),
        last.latitude.toFixed(5),
        last.longitude.toFixed(5),
    ].join('|');
}

function getPuckTiltVariant(pitch = 0) {
    if (pitch < 20) {
        return 'flat';
    }

    if (pitch < 46) {
        return 'medium';
    }

    return 'high';
}

export default function PredictiveMapScene({
    insets,
    isActive,
    isDark,
    routeMetrics,
    sceneConfig,
}) {
    const mapRef = useRef(null);
    const puckRef = useRef(null);
    const animationFrameRef = useRef(null);
    const lastCameraSignatureRef = useRef('');
    const lastTickRef = useRef({
        activeCamera: null,
        elapsedMs: 0,
        startedAtMs: 0,
        lastPuckUpdateMs: 0,
    });
    const stateRefs = useRef({
        chipRevealState: { expensive: false, destination: false },
        passedStationState: 'default',
        routeSignature: '',
    });
    const [isMapReady, setIsMapReady] = useState(false);
    const [routeCoordinates, setRouteCoordinates] = useState(() => (
        routeMetrics?.initialRouteMetrics?.coordinates
        || routeMetrics?.coordinates
        || []
    ));
    const [chipRevealState, setChipRevealState] = useState({ expensive: false, destination: false });
    const [passedStationState, setPassedStationState] = useState('default');
    const [puckTiltVariant, setPuckTiltVariant] = useState(() => getPuckTiltVariant(sceneConfig.cameraPitch));

    const initialPuckCoordinate = useMemo(() => (
        routeMetrics?.initialCoordinate
        || routeMetrics?.coordinates?.[0]
        || sceneConfig.origin
    ), [routeMetrics, sceneConfig.origin]);

    useEffect(() => {
        setRouteCoordinates(
            routeMetrics?.initialRouteMetrics?.coordinates
            || routeMetrics?.coordinates
            || []
        );
        setChipRevealState({ expensive: false, destination: false });
        setPassedStationState('default');
        stateRefs.current = {
            chipRevealState: { expensive: false, destination: false },
            passedStationState: 'default',
            routeSignature: createRouteSignature(
                routeMetrics?.initialRouteMetrics?.coordinates
                || routeMetrics?.coordinates
                || []
            ),
        };
        setPuckTiltVariant(getPuckTiltVariant(sceneConfig.cameraPitch));
        lastTickRef.current = {
            activeCamera: null,
            elapsedMs: 0,
            startedAtMs: 0,
            lastPuckUpdateMs: 0,
        };
        lastCameraSignatureRef.current = '';
    }, [routeMetrics]);

    useEffect(() => {
        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!isActive) {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }

            lastTickRef.current = {
                activeCamera: null,
                elapsedMs: 0,
                startedAtMs: 0,
                lastPuckUpdateMs: 0,
            };
            lastCameraSignatureRef.current = '';
            return;
        }

        if (!isMapReady || !routeMetrics || !mapRef.current) {
            return;
        }

        const tick = timestampMs => {
            if (!isActive || !mapRef.current || !routeMetrics) {
                animationFrameRef.current = null;
                return;
            }

            if (!lastTickRef.current.startedAtMs) {
                lastTickRef.current.startedAtMs = timestampMs;
                puckRef.current?.setTo(initialPuckCoordinate);
            }

            const elapsedMs = timestampMs - lastTickRef.current.startedAtMs;
            const normalizedProgress = Math.min(elapsedMs / sceneConfig.loopDurationMs, 1);
            const arrivalElapsedMs = Math.max(0, elapsedMs - sceneConfig.loopDurationMs);
            const snapshot = getDemoSnapshot(
                routeMetrics,
                sceneConfig,
                normalizedProgress,
                arrivalElapsedMs
            );
            const deltaMs = Math.max(16.67, elapsedMs - lastTickRef.current.elapsedMs);
            const smoothedCamera = smoothCamera(
                lastTickRef.current.activeCamera,
                snapshot.activeCamera,
                sceneConfig,
                deltaMs
            );

            const cameraSignature = createCameraSignature(smoothedCamera);
            if (cameraSignature !== lastCameraSignatureRef.current) {
                mapRef.current.setCamera({
                    center: smoothedCamera.center,
                    heading: smoothedCamera.heading,
                    pitch: smoothedCamera.pitch,
                    altitude: smoothedCamera.altitude,
                });
                lastCameraSignatureRef.current = cameraSignature;
            }

            const nextPuckTiltVariant = getPuckTiltVariant(smoothedCamera?.pitch || 0);
            if (nextPuckTiltVariant !== puckTiltVariant) {
                setPuckTiltVariant(nextPuckTiltVariant);
            }

            if (snapshot.carCoordinate) {
                const puckDurationMs = lastTickRef.current.lastPuckUpdateMs
                    ? Math.max(16, Math.min(72, timestampMs - lastTickRef.current.lastPuckUpdateMs))
                    : 24;
                puckRef.current?.moveTo(snapshot.carCoordinate, puckDurationMs);
                lastTickRef.current.lastPuckUpdateMs = timestampMs;
            }

            const nextChipRevealState = snapshot.chipRevealState || { expensive: false, destination: false };
            if (
                nextChipRevealState.expensive !== stateRefs.current.chipRevealState.expensive ||
                nextChipRevealState.destination !== stateRefs.current.chipRevealState.destination
            ) {
                stateRefs.current.chipRevealState = nextChipRevealState;
                setChipRevealState(nextChipRevealState);
            }

            if (snapshot.passedStationState !== stateRefs.current.passedStationState) {
                stateRefs.current.passedStationState = snapshot.passedStationState;
                setPassedStationState(snapshot.passedStationState);
            }

            const nextRouteCoordinates = snapshot.visibleRouteCoordinates || [];
            const nextRouteSignature = createRouteSignature(nextRouteCoordinates);
            if (nextRouteSignature !== stateRefs.current.routeSignature) {
                stateRefs.current.routeSignature = nextRouteSignature;
                setRouteCoordinates(nextRouteCoordinates);
            }

            lastTickRef.current.activeCamera = smoothedCamera;
            lastTickRef.current.elapsedMs = elapsedMs;
            animationFrameRef.current = requestAnimationFrame(tick);
        };

        animationFrameRef.current = requestAnimationFrame(tick);

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [
        initialPuckCoordinate,
        isActive,
        isMapReady,
        puckTiltVariant,
        routeMetrics,
        sceneConfig,
    ]);

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFill}
                initialCamera={{
                    center: routeMetrics?.initialCoordinate || sceneConfig.origin,
                    heading: routeMetrics?.initialHeading || 214,
                    pitch: sceneConfig.cameraPitch,
                    altitude: sceneConfig.cameraAltitudes.driving,
                }}
                initialRegion={routeMetrics?.routeRegion || {
                    latitude: sceneConfig.origin.latitude,
                    longitude: sceneConfig.origin.longitude,
                    latitudeDelta: 0.018,
                    longitudeDelta: 0.018,
                }}
                provider={PROVIDER_APPLE}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled
                toolbarEnabled={false}
                cacheEnabled={false}
                loadingEnabled={false}
                showsBuildings
                showsCompass={false}
                pointsOfInterestFilter={[]}
                showsPointsOfInterests={false}
                showsScale={false}
                showsTraffic={false}
                legalLabelInsets={{
                    top: 0,
                    left: 12,
                    right: 12,
                    bottom: insets.bottom + sceneConfig.legalLabelBottomInset,
                }}
                pointerEvents="none"
                onMapLoaded={() => {
                    setIsMapReady(true);
                }}
                onMapReady={() => {
                    setIsMapReady(true);
                }}
            >
                {routeCoordinates.length > 1 ? (
                    <Polyline
                        coordinates={routeCoordinates}
                        strokeColor={isDark ? '#4DA3FF' : '#007AFF'}
                        strokeWidth={5}
                        lineCap="round"
                        lineJoin="round"
                    />
                ) : null}

                <RouteStationMarker
                    coordinate={sceneConfig.expensiveStation.coordinate}
                    emphasisState={passedStationState}
                    isDark={isDark}
                    isVisible={chipRevealState.expensive}
                    price={sceneConfig.expensiveStation.price}
                    role="expensive"
                />

                <RouteStationMarker
                    coordinate={sceneConfig.destinationStation.coordinate}
                    emphasisState="highlighted"
                    isDark={isDark}
                    isVisible={chipRevealState.destination}
                    price={sceneConfig.destinationStation.price}
                    role="destination"
                />

                <MockVehicleMarker
                    ref={puckRef}
                    initialCoordinate={initialPuckCoordinate}
                    tiltVariant={puckTiltVariant}
                />
            </MapView>
        </View>
    );
}
