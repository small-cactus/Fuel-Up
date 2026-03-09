import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { LiquidGlassView as GlassView } from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';

function getContainerStyle(role, emphasisState) {
    if (role === 'destination') {
        return styles.destinationShell;
    }

    if (emphasisState === 'highlighted') {
        return styles.expensiveShellHighlighted;
    }

    if (emphasisState === 'dimmed') {
        return styles.expensiveShellDimmed;
    }

    return styles.expensiveShellDefault;
}

export default function RouteStationMarker({
    coordinate,
    emphasisState = 'default',
    isDark,
    price,
    role = 'expensive',
}) {
    if (!coordinate) {
        return null;
    }

    const containerStyle = getContainerStyle(role, emphasisState);

    return (
        <Marker
            coordinate={coordinate}
            anchor={{ x: 0.5, y: 0.84 }}
            tracksViewChanges={false}
            zIndex={role === 'destination' ? 4 : 3}
        >
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
        </Marker>
    );
}

const styles = StyleSheet.create({
    destinationShell: {
        transform: [{ scale: 1.04 }],
    },
    expensiveShellDefault: {
        transform: [{ scale: 0.98 }],
    },
    expensiveShellHighlighted: {
        transform: [{ scale: 1.08 }],
    },
    expensiveShellDimmed: {
        transform: [{ scale: 0.9 }],
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
