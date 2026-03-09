import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AnimatedRegion, MarkerAnimated } from 'react-native-maps';

function createAnimatedCoordinate(coordinate) {
    return new AnimatedRegion({
        latitude: coordinate?.latitude || 0,
        longitude: coordinate?.longitude || 0,
        latitudeDelta: 0,
        longitudeDelta: 0,
    });
}

function getPuckProjection(mapPitch = 0) {
    const normalizedPitch = Math.max(0, Math.min(1, mapPitch / 70));

    return {
        wrapperTransform: {
            transform: [
                { perspective: 600 },
                { scaleX: 1 + normalizedPitch * 0.1 },
                { scaleY: 1 - normalizedPitch * 0.28 },
                { translateY: normalizedPitch * 3.5 },
            ],
        },
        bluePuckShadow: {
            shadowOpacity: 0.32 + normalizedPitch * 0.12,
            shadowRadius: 7 + normalizedPitch * 2,
            shadowOffset: {
                width: 0,
                height: 2 + normalizedPitch * 2,
            },
        },
    };
}

export default function MockVehicleMarker({ coordinate, mapPitch = 0 }) {
    const animatedCoordinate = useMemo(
        () => createAnimatedCoordinate(coordinate),
        []
    );
    const puckProjection = useMemo(() => getPuckProjection(mapPitch), [mapPitch]);

    useEffect(() => {
        if (!coordinate) {
            return undefined;
        }

        animatedCoordinate.setValue({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            latitudeDelta: 0,
            longitudeDelta: 0,
        });

        return undefined;
    }, [
        animatedCoordinate,
        coordinate?.latitude,
        coordinate?.longitude,
        coordinate,
    ]);

    if (!coordinate) {
        return null;
    }

    return (
        <MarkerAnimated
            coordinate={animatedCoordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            centerOffset={{ x: 0, y: 0 }}
            flat
            tracksViewChanges
            zIndex={5}
        >
            <View style={[styles.whitePuck, puckProjection.wrapperTransform]}>
                <View style={[styles.bluePuck, puckProjection.bluePuckShadow]}>
                    <View style={styles.blueCore} />
                </View>
            </View>
        </MarkerAnimated>
    );
}

const styles = StyleSheet.create({
    whitePuck: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000000',
        shadowOpacity: 0.14,
        shadowRadius: 10,
        shadowOffset: {
            width: 0,
            height: 3,
        },
    },
    bluePuck: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#0A84FF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#0A84FF',
        shadowOpacity: 0.38,
        shadowRadius: 8,
        shadowOffset: {
            width: 0,
            height: 3,
        },
    },
    blueCore: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#0A84FF',
    },
});
