import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

function formatPrice(price) {
    if (typeof price !== 'number' || Number.isNaN(price)) {
        return null;
    }

    return `$${price.toFixed(2)}`;
}

export default function PredictedPriceFlag({ validation, isDark, themeColors, compact = false }) {
    if (!validation?.usedPrediction) {
        return null;
    }

    const predictedPrice = formatPrice(validation.finalPrice ?? validation.predictedPrice);
    const apiPrice = formatPrice(validation.apiPrice);
    const tint = isDark ? 'rgba(255, 184, 0, 0.7)' : 'rgba(180, 110, 0, 0.85)';
    const iconTint = isDark ? 'rgba(255, 184, 0, 0.85)' : 'rgba(180, 110, 0, 0.95)';

    const handlePress = () => {
        const detailLines = [
            'This price was predicted from nearby market movement and trusted station history because the feed looked stale or uncertain.',
            'It should usually be close, but gas can still change faster than the API updates, so the pump price may be different.',
        ];

        if (predictedPrice || apiPrice) {
            detailLines.push([
                predictedPrice ? `Showing ${predictedPrice}` : null,
                apiPrice ? `feed said ${apiPrice}` : null,
            ].filter(Boolean).join(' while the '));
        }

        Alert.alert(
            'Estimated price',
            detailLines.join('\n\n')
        );
    };

    if (compact) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Estimated price, tap for details"
                onPress={handlePress}
                hitSlop={6}
                style={styles.compactBadge}
            >
                <SymbolView name="info.circle" size={12} tintColor={iconTint} />
            </Pressable>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Estimated price, tap for details"
            onPress={handlePress}
            hitSlop={4}
            style={styles.subtleBadge}
        >
            <SymbolView name="info.circle" size={11} tintColor={iconTint} />
            <Text style={[styles.subtleBadgeText, { color: tint }]}>est.</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    subtleBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        flexShrink: 0,
    },
    subtleBadgeText: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.1,
    },
    compactBadge: {
        flexShrink: 0,
        padding: 2,
    },
});
