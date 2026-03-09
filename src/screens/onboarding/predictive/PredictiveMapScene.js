import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Polyline, PROVIDER_APPLE } from 'react-native-maps';

import MockVehicleMarker from './MockVehicleMarker';
import RouteStationMarker from './RouteStationMarker';

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
        const signature = createCameraSignature(nextCamera);

        if (signature === lastCameraSignatureRef.current) {
            return;
        }

        lastCameraSignatureRef.current = signature;
        mapRef.current.setCamera(nextCamera);
    }, [
        demoState?.activeCamera,
        isMapReady,
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
