import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { LiquidGlassView as GlassView } from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';
import Animated, {
    Easing,
    Extrapolate,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

const AnimatedView = Animated.createAnimatedComponent(View);
const APPEAR_START_SCALE = 0.84;
const APPEAR_DURATION_MS = 220;
const TRACKS_VIEW_CHANGES_IDLE_MS = 180;

function getBaseScale(role, emphasisState) {
    if (role === 'destination') {
        return 1.04;
    }

    if (emphasisState === 'highlighted') {
        return 1.08;
    }

    if (emphasisState === 'dimmed') {
        return 0.9;
    }

    return 0.98;
}

function getContainerStyle(role, emphasisState) {
    if (role === 'destination') {
        return styles.destinationShell;
    }

    if (emphasisState === 'dimmed') {
        return styles.expensiveShellDimmed;
    }

    return null;
}

function getMarkerPlacement(role) {
    if (role === 'destination') {
        return {
            anchor: { x: 0.5, y: 0.92 },
            centerOffset: { x: 0, y: -28 },
        };
    }

    return {
        anchor: { x: 0.5, y: 0.84 },
        centerOffset: { x: 0, y: -10 },
    };
}

export default function RouteStationMarker({
    coordinate,
    emphasisState = 'default',
    isDark,
    isVisible = true,
    price,
    role = 'expensive',
}) {
    const appearProgress = useSharedValue(isVisible ? 1 : 0);
    const tracksViewChangesTimeoutRef = useRef(null);
    const visualStateSignatureRef = useRef('');
    const [tracksViewChanges, setTracksViewChanges] = useState(isVisible);

    useEffect(() => {
        return () => {
            if (tracksViewChangesTimeoutRef.current) {
                clearTimeout(tracksViewChangesTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!isVisible) {
            appearProgress.value = 0;
            setTracksViewChanges(false);
            if (tracksViewChangesTimeoutRef.current) {
                clearTimeout(tracksViewChangesTimeoutRef.current);
                tracksViewChangesTimeoutRef.current = null;
            }
            return;
        }

        appearProgress.value = 0;
        setTracksViewChanges(true);
        appearProgress.value = withTiming(1, {
            duration: APPEAR_DURATION_MS,
            easing: Easing.out(Easing.cubic),
        });

        if (tracksViewChangesTimeoutRef.current) {
            clearTimeout(tracksViewChangesTimeoutRef.current);
        }

        tracksViewChangesTimeoutRef.current = setTimeout(() => {
            tracksViewChangesTimeoutRef.current = null;
            setTracksViewChanges(false);
        }, APPEAR_DURATION_MS + TRACKS_VIEW_CHANGES_IDLE_MS);
    }, [appearProgress, isVisible]);

    const visualStateSignature = [
        emphasisState,
        isDark ? '1' : '0',
        price,
        role,
        isVisible ? '1' : '0',
    ].join('|');

    useEffect(() => {
        if (!isVisible || visualStateSignatureRef.current === visualStateSignature) {
            return;
        }

        visualStateSignatureRef.current = visualStateSignature;
        setTracksViewChanges(true);

        if (tracksViewChangesTimeoutRef.current) {
            clearTimeout(tracksViewChangesTimeoutRef.current);
        }

        tracksViewChangesTimeoutRef.current = setTimeout(() => {
            tracksViewChangesTimeoutRef.current = null;
            setTracksViewChanges(false);
        }, TRACKS_VIEW_CHANGES_IDLE_MS);
    }, [isVisible, visualStateSignature]);

    if (!coordinate) {
        return null;
    }

    const containerStyle = getContainerStyle(role, emphasisState);
    const markerPlacement = getMarkerPlacement(role);
    const baseScale = getBaseScale(role, emphasisState);
    const revealStyle = useAnimatedStyle(() => ({
        transform: [{
            scale: baseScale * interpolate(
                appearProgress.value,
                [0, 1],
                [APPEAR_START_SCALE, 1],
                Extrapolate.CLAMP
            ),
        }],
    }), [appearProgress, baseScale]);

    if (!isVisible) {
        return null;
    }

    return (
        <Marker
            coordinate={coordinate}
            anchor={markerPlacement.anchor}
            centerOffset={markerPlacement.centerOffset}
            tracksViewChanges={tracksViewChanges}
            zIndex={role === 'destination' ? 4 : 3}
        >
            <AnimatedView style={revealStyle}>
                <View style={containerStyle}>
                    <GlassView
                        tintColor={role === 'destination' ? 'rgba(0, 255, 47, 0.3)' : 'rgba(255, 25, 0, 0.3)'}
                        effect="clear"
                        colorScheme={isDark ? 'dark' : 'light'}
                        interactive={false}
                        style={styles.markerGlass}
                    >
                        <SymbolView
                            name="fuelpump.fill"
                            size={14}
                            tintColor={isDark ? '#FFFFFF' : '#000000'}
                            style={styles.markerIcon}
                        />
                        <Text style={[styles.priceText, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                            ${price.toFixed(2)}
                        </Text>
                    </GlassView>
                </View>
            </AnimatedView>
        </Marker>
    );
}

const styles = StyleSheet.create({
    destinationShell: {
    },
    expensiveShellDimmed: {
        opacity: 0.82,
    },
    markerGlass: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
        overflow: 'hidden',
    },
    markerIcon: {
        marginRight: 2,
    },
    priceText: {
        fontSize: 15,
        fontWeight: '700',
    },
});
