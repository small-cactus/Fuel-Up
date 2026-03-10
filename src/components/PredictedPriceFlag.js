import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

function formatPrice(price) {
    if (typeof price !== 'number' || Number.isNaN(price)) {
        return null;
    }

    return `$${price.toFixed(2)}`;
}

export default function PredictedPriceFlag({ validation, isDark, themeColors }) {
    if (!validation?.usedPrediction) {
        return null;
    }

    const label = validation.decision === 'reject' ? 'Adjusted' : 'Estimated';
    const backgroundColor = isDark ? 'rgba(255, 184, 0, 0.24)' : 'rgba(255, 184, 0, 0.18)';
    const predictedPrice = formatPrice(validation.finalPrice ?? validation.predictedPrice);
    const apiPrice = formatPrice(validation.apiPrice);

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

    return (
        <Pressable
            accessibilityRole="button"
            onPress={handlePress}
            style={[styles.badge, { backgroundColor }]}
        >
            <View style={styles.badgeContent}>
                <SymbolView name="exclamationmark.circle.fill" size={12} tintColor={themeColors.text} />
                <Text style={[styles.badgeText, { color: themeColors.text }]}>{label}</Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    badge: {
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
    },
    badgeContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.2,
        textTransform: 'uppercase',
    },
});
