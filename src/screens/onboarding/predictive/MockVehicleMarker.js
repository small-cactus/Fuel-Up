import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { AnimatedRegion, MarkerAnimated } from 'react-native-maps';
import { SymbolView } from 'expo-symbols';

const AnimatedView = Animated.createAnimatedComponent(View);

function createAnimatedCoordinate(coordinate) {
    return new AnimatedRegion({
        latitude: coordinate?.latitude || 0,
        longitude: coordinate?.longitude || 0,
        latitudeDelta: 0,
        longitudeDelta: 0,
    });
}

function getShortestHeadingDelta(previousHeading, nextHeading) {
    return ((nextHeading - previousHeading + 540) % 360) - 180;
}

export default function MockVehicleMarker({ coordinate, heading = 0 }) {
    const animatedCoordinate = useMemo(
        () => createAnimatedCoordinate(coordinate),
        []
    );
    const animatedHeading = useRef(new Animated.Value(heading)).current;
    const headingValueRef = useRef(heading);

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

    useEffect(() => {
        const nextHeadingValue = headingValueRef.current + getShortestHeadingDelta(headingValueRef.current, heading);
        headingValueRef.current = nextHeadingValue;
        animatedHeading.setValue(nextHeadingValue);
    }, [animatedHeading, heading]);

    const rotation = animatedHeading.interpolate({
        inputRange: [-720, 0, 720],
        outputRange: ['-720deg', '0deg', '720deg'],
    });

    if (!coordinate) {
        return null;
    }

    return (
        <MarkerAnimated
            coordinate={animatedCoordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            centerOffset={{ x: 0, y: 0 }}
            tracksViewChanges
            zIndex={5}
        >
            <View style={styles.outerHalo}>
                <View style={styles.innerPuck}>
                    <AnimatedView style={[styles.directionGlyph, { transform: [{ rotate: rotation }] }]}>
                        <SymbolView name="location.north.fill" size={15} tintColor="#FFFFFF" />
                    </AnimatedView>
                </View>
            </View>
        </MarkerAnimated>
    );
}

const styles = StyleSheet.create({
    outerHalo: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: 'rgba(10,132,255,0.22)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    innerPuck: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#0A84FF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#0A84FF',
        shadowOpacity: 0.42,
        shadowRadius: 10,
        shadowOffset: {
            width: 0,
            height: 4,
        },
    },
    directionGlyph: {
        alignItems: 'center',
        justifyContent: 'center',
    },
});
