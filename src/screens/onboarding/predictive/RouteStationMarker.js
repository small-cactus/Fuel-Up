import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { LiquidGlassView } from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';

const PRICE_COLOR_BY_ROLE = {
    destination: '#34C759',
    expensive: '#FF5A5F',
};

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
    brand,
    coordinate,
    emphasisState = 'default',
    price,
    role = 'expensive',
}) {
    if (!coordinate) {
        return null;
    }

    const priceColor = PRICE_COLOR_BY_ROLE[role] || '#FFFFFF';
    const containerStyle = getContainerStyle(role, emphasisState);

    return (
        <Marker
            coordinate={coordinate}
            anchor={{ x: 0.5, y: 0.84 }}
            tracksViewChanges={false}
            zIndex={role === 'destination' ? 4 : 3}
        >
            <View style={containerStyle}>
                <LiquidGlassView effect="clear" style={styles.markerGlass}>
                    <View style={styles.markerRow}>
                        <SymbolView name="fuelpump.fill" size={13} tintColor={priceColor} />
                        <Text style={[styles.priceText, { color: priceColor }]}>${price.toFixed(2)}</Text>
                    </View>
                    <Text style={styles.brandText}>{brand}</Text>
                </LiquidGlassView>
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
        minWidth: 88,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    markerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    priceText: {
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    brandText: {
        marginTop: 2,
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.3,
        textTransform: 'uppercase',
    },
});
