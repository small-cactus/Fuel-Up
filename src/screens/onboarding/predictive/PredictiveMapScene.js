import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Polyline, PROVIDER_APPLE } from 'react-native-maps';

import MockVehicleMarker from './MockVehicleMarker';
import RouteStationMarker from './RouteStationMarker';

function buildRouteGradient(coordinates) {
    return coordinates.map((_, index) => {
        const progress = coordinates.length <= 1
            ? 1
            : index / (coordinates.length - 1);
        const alpha = 0.78 + progress * 0.22;
        return `rgba(10,132,255,${alpha.toFixed(3)})`;
    });
}

export default function PredictiveMapScene({
    demoState,
    insets,
    isActive,
    isDark,
    routeMetrics,
    sceneConfig,
}) {
    const mapRef = useRef(null);
    const lastCameraSignatureRef = useRef('');
    const [isMapReady, setIsMapReady] = useState(false);

    const routeCoordinates = routeMetrics?.coordinates || [];
    const routeGradient = useMemo(
        () => buildRouteGradient(routeCoordinates),
        [routeCoordinates]
    );

    useEffect(() => {
        if (!isMapReady || !mapRef.current || !demoState?.activeCamera) {
            return;
        }

        const nextCamera = {
            center: demoState.activeCamera.center,
            heading: demoState.activeCamera.heading,
            pitch: demoState.activeCamera.pitch,
            altitude: demoState.activeCamera.altitude,
        };
        const signature = JSON.stringify(nextCamera);

        if (signature === lastCameraSignatureRef.current) {
            return;
        }

        lastCameraSignatureRef.current = signature;
        mapRef.current.animateCamera(nextCamera, {
            duration: isActive ? sceneConfig.cameraAnimationMs : 0,
        });
    }, [demoState?.activeCamera, isActive, isMapReady, sceneConfig.cameraAnimationMs]);

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFill}
                initialCamera={routeMetrics ? {
                    center: routeMetrics.initialCoordinate,
                    heading: routeMetrics.initialHeading,
                    pitch: sceneConfig.cameraPitch,
                    altitude: sceneConfig.cameraAltitudes.driving,
                } : undefined}
                initialRegion={routeMetrics?.routeRegion}
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
                    <>
                        <Polyline
                            coordinates={routeCoordinates}
                            strokeColor={isDark ? 'rgba(4,10,18,0.82)' : 'rgba(255,255,255,0.92)'}
                            strokeWidth={12}
                            lineCap="round"
                            lineJoin="round"
                        />
                        <Polyline
                            coordinates={routeCoordinates}
                            strokeColor="#0A84FF"
                            strokeColors={Platform.OS === 'ios' ? routeGradient : undefined}
                            strokeWidth={6}
                            lineCap="round"
                            lineJoin="round"
                        />
                    </>
                ) : null}

                <RouteStationMarker
                    brand={sceneConfig.expensiveStation.brand}
                    coordinate={sceneConfig.expensiveStation.coordinate}
                    emphasisState={demoState.passedStationState}
                    price={sceneConfig.expensiveStation.price}
                    role="expensive"
                />

                <RouteStationMarker
                    brand={sceneConfig.destinationStation.brand}
                    coordinate={sceneConfig.destinationStation.coordinate}
                    emphasisState="highlighted"
                    price={sceneConfig.destinationStation.price}
                    role="destination"
                />

                <MockVehicleMarker
                    coordinate={demoState.carCoordinate}
                    heading={demoState.heading}
                />
            </MapView>
        </View>
    );
}
