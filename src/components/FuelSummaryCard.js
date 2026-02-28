import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GlassContainer, GlassView } from 'expo-glass-effect';

function formatPrice(price) {
    if (typeof price !== 'number' || Number.isNaN(price)) {
        return '--';
    }

    return price.toFixed(3);
}

function formatDistance(distanceMiles) {
    if (typeof distanceMiles !== 'number' || Number.isNaN(distanceMiles)) {
        return '';
    }

    if (distanceMiles < 0.1) {
        return 'Right here';
    }

    return `${distanceMiles.toFixed(1)} mi away`;
}

export default function FuelSummaryCard({
    isDark,
    isRefreshing,
    errorMsg,
    quote,
    benchmarkQuote,
    themeColors,
}) {
    const hasFailureState = !quote && Boolean(errorMsg);
    const title = hasFailureState ? 'No Prices Returned' : 'Cheapest Nearby';
    const subtitle = quote ? formatDistance(quote?.distanceMiles) : null;
    const benchmarkLine =
        benchmarkQuote && quote && benchmarkQuote.providerId !== quote.providerId
            ? `${benchmarkQuote.sourceLabel}: $${formatPrice(benchmarkQuote.price)} / gal`
            : null;

    return (
        <GlassContainer spacing={0} style={styles.cardGroup}>
            <GlassView
                style={styles.card}
                tintColor={isDark ? '#000000' : '#FFFFFF'}
                glassEffectStyle={{
                    style: 'clear',
                    animate: true,
                    animationDuration: 0.2,
                }}
                key={isDark ? 'dark' : 'light'}
            >
                <View style={styles.headerRow}>
                    <Text style={[styles.cardTitle, { color: themeColors.text }]}>{title}</Text>
                    {isRefreshing ? <ActivityIndicator size="small" color={themeColors.text} /> : null}
                </View>

                <Text style={[styles.cardPrice, { color: themeColors.text }]}>
                    ${formatPrice(quote?.price)} <Text style={styles.cardPriceUnit}>/gal</Text>
                </Text>

                <Text style={[styles.cardAddress, { color: themeColors.text }]}>
                    {quote?.stationName || (hasFailureState ? 'We could not find a nearby station price.' : 'Finding the fastest available fuel feed')}
                </Text>
                <Text style={[styles.cardSubtitle, { color: themeColors.text }]}>
                    {quote?.address || (hasFailureState ? 'Try again once live provider data is available.' : 'Checking nearby providers')}
                </Text>

                <View style={styles.footerBlock}>
                    <Text style={[styles.cardMeta, { color: themeColors.text }]}>
                        {subtitle || (hasFailureState ? 'No prices returned' : 'Loading your location')}
                    </Text>
                    {benchmarkLine ? <Text style={[styles.cardMeta, { color: themeColors.text }]}>{benchmarkLine}</Text> : null}
                    {errorMsg ? <Text style={[styles.cardNotice, { color: themeColors.text }]}>{errorMsg}</Text> : null}
                </View>
            </GlassView>
        </GlassContainer>
    );
}

const styles = StyleSheet.create({
    cardGroup: {
        width: '100%',
        maxWidth: 560,
    },
    card: {
        minHeight: 208,
        padding: 24,
        borderRadius: 32,
        overflow: 'hidden',
        justifyContent: 'space-between',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 8,
    },
    cardPrice: {
        fontSize: 36,
        fontWeight: '800',
        marginBottom: 4,
    },
    cardPriceUnit: {
        fontSize: 14,
    },
    cardAddress: {
        fontSize: 16,
        fontWeight: '600',
    },
    cardSubtitle: {
        fontSize: 13,
        marginTop: 4,
        opacity: 0.7,
    },
    footerBlock: {
        marginTop: 16,
        gap: 4,
    },
    cardMeta: {
        fontSize: 12,
        lineHeight: 18,
        opacity: 0.82,
    },
    cardNotice: {
        fontSize: 12,
        lineHeight: 18,
        marginTop: 6,
        opacity: 0.88,
    },
});
