import React, { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GlassContainer, GlassView } from 'expo-glass-effect';

import { SymbolView } from 'expo-symbols';
import PredictedPriceFlag from './PredictedPriceFlag';
import {
    FUEL_GRADE_ORDER,
    getFuelGradeMeta,
    normalizeFuelGrade,
    resolveQuotePriceForFuelGrade,
} from '../lib/fuelGrade';

const BEST_PRICE_LIGHT = '#007AFF';
const BEST_PRICE_DARK = '#11f050ff';
const CARD_GLASS_EFFECT_STYLE = {
    style: 'clear',
    animate: true,
    animationDuration: 0.2,
};

function formatPrice(price) {
    if (typeof price !== 'number' || Number.isNaN(price)) {
        return '--';
    }

    return price.toFixed(2);
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

function formatRelativeTime(updatedAt) {
    if (!updatedAt) return 'Unknown';
    const updated = new Date(updatedAt).getTime();
    const now = Date.now();
    const diffMins = Math.floor((now - updated) / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

function truncateStationTitle(title, { hasPredictionFlag, hasRating }) {
    if (typeof title !== 'string') {
        return title;
    }

    const maxLength = hasPredictionFlag && hasRating
        ? 16
        : hasPredictionFlag
            ? 22
            : hasRating
                ? 24
                : 32;

    if (title.length <= maxLength) {
        return title;
    }

    return `${title.slice(0, maxLength - 1).trimEnd()}…`;
}

function FuelSummaryCard({
    isDark,
    isRefreshing,
    errorMsg,
    quote,
    benchmarkQuote,
    themeColors,
    rank,
    glassTintColor,
    fuelGrade = 'regular',
}) {
    const selectedFuelGrade = normalizeFuelGrade(fuelGrade);
    const selectedGradeMeta = getFuelGradeMeta(selectedFuelGrade);
    const selectedGradePrice = resolveQuotePriceForFuelGrade(quote, selectedFuelGrade);
    const additionalGradePrices = FUEL_GRADE_ORDER
        .filter(grade => grade !== selectedFuelGrade)
        .map(grade => ({
            grade,
            price: resolveQuotePriceForFuelGrade(
                quote,
                grade,
                { allowFallbackToQuotePrice: false }
            ),
            meta: getFuelGradeMeta(grade),
        }));
    const bestPriceColor = isDark ? BEST_PRICE_DARK : BEST_PRICE_LIGHT;
    const hasFailureState = !quote && Boolean(errorMsg);
    const title = hasFailureState ? 'No Prices Returned' : quote?.stationName || 'Cheapest Nearby';
    const showPredictedPriceFlag = Boolean(quote?.validation?.usedPrediction);
    const showRating = quote?.rating != null;
    const displayTitle = truncateStationTitle(title, {
        hasPredictionFlag: showPredictedPriceFlag,
        hasRating: showRating,
    });
    const subtitle = quote ? formatDistance(quote?.distanceMiles) : null;
    const benchmarkLine =
        benchmarkQuote && quote && benchmarkQuote.providerId !== quote.providerId
            ? `${benchmarkQuote.sourceLabel}: $${formatPrice(benchmarkQuote.price)} / gal`
            : null;

    return (
        <GlassContainer spacing={0} style={styles.cardGroup}>
            <GlassView
                style={styles.card}
                tintColor={glassTintColor ?? (isDark ? '#101010ff' : '#FFFFFF')}
                glassEffectStyle={CARD_GLASS_EFFECT_STYLE}
            >
                <View style={styles.headerRow}>
                    <View style={styles.headerContent}>
                        <View style={styles.titleRow}>
                            {rank ? (
                                <View style={[styles.rankBadge, { backgroundColor: themeColors.text }]}>
                                    <Text style={[styles.rankText, { color: themeColors.background }]}>#{rank}</Text>
                                </View>
                            ) : null}
                            <Text style={[styles.cardTitle, { color: themeColors.text }]} numberOfLines={1}>
                                {displayTitle}
                            </Text>
                            <PredictedPriceFlag
                                validation={quote?.validation}
                                isDark={isDark}
                                themeColors={themeColors}
                            />
                            {showRating ? (
                                <View style={styles.ratingRow}>
                                    <SymbolView name="star.fill" size={12} tintColor="#FFB800" />
                                    <Text style={[styles.ratingText, { color: themeColors.text }]}>
                                        {quote.rating.toFixed(1)}
                                    </Text>
                                    {quote?.userRatingCount != null && (
                                        <Text style={[styles.ratingCount, { color: themeColors.text }]}>
                                            ({quote.userRatingCount.toLocaleString()})
                                        </Text>
                                    )}
                                </View>
                            ) : null}
                        </View>
                    </View>
                    {isRefreshing ? <ActivityIndicator size="small" color={themeColors.text} /> : null}
                </View>

                <View style={styles.pricesRow}>
                    <View style={styles.priceColumn}>
                        <View style={styles.gradeLabelRow}>
                            <Text style={[styles.priceLabel, { color: themeColors.text }]}>{selectedGradeMeta.label}</Text>
                            <Text style={[styles.octaneLabel, { color: themeColors.text }]}>{selectedGradeMeta.octane}</Text>
                        </View>
                        <Text style={[styles.cardPrice, { color: bestPriceColor }]}>
                            ${formatPrice(selectedGradePrice)}
                        </Text>
                    </View>

                    {additionalGradePrices.map(({ grade, meta, price }) => (
                        <View key={grade} style={styles.priceColumn}>
                            <View style={styles.gradeLabelRow}>
                                <Text style={[styles.priceLabel, { color: themeColors.text }]}>{meta.shortLabel}</Text>
                                <Text style={[styles.octaneLabel, { color: themeColors.text }]}>{meta.octane}</Text>
                            </View>
                            <Text style={[styles.cardPrice, { color: themeColors.text }]}>
                                ${formatPrice(price)}
                            </Text>
                        </View>
                    ))}
                </View>

                <Text style={[styles.cardAddress, { color: themeColors.text }]}>
                    {quote?.address || (hasFailureState ? 'Try again once live provider data is available.' : 'Checking nearby providers')}
                </Text>

                <View style={styles.footerBlock}>
                    <Text style={[styles.cardMeta, { color: themeColors.text }]}>
                        {subtitle || (hasFailureState ? 'No prices returned' : 'Loading your location')}
                    </Text>

                    {quote?.updatedAt && (
                        <View style={styles.timeRow}>
                            <SymbolView name="clock.fill" size={12} tintColor={themeColors.text} style={{ opacity: 0.7 }} />
                            <Text style={[styles.cardMeta, { color: themeColors.text }]}>
                                {formatRelativeTime(quote.updatedAt)}
                            </Text>
                        </View>
                    )}
                </View>
                {errorMsg ? <Text style={[styles.cardNotice, { color: themeColors.text }]}>{errorMsg}</Text> : null}
            </GlassView>
        </GlassContainer>
    );
}

export default memo(FuelSummaryCard);

const styles = StyleSheet.create({
    cardGroup: {
        width: '100%',
    },
    card: {
        padding: 24,
        borderRadius: 32,
        overflow: 'hidden',
        justifyContent: 'space-between',
        shadowColor: 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 12,
    },
    headerContent: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        flexShrink: 0,
    },
    ratingText: {
        fontSize: 13,
        fontWeight: '600',
    },
    ratingCount: {
        fontSize: 12,
        fontWeight: '400',
        opacity: 0.6,
    },
    rankBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        marginRight: 8,
    },
    rankText: {
        fontSize: 13,
        fontWeight: '800',
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: '700',
        flexShrink: 1,
        minWidth: 0,
    },
    pricesRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
        gap: 12,
    },
    priceColumn: {
        flex: 1,
    },
    gradeLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    octaneLabel: {
        fontSize: 10,
        fontWeight: '500',
        opacity: 0.5,
    },
    priceLabel: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        opacity: 0.6,
        marginBottom: 4,
    },
    cardPrice: {
        fontSize: 24,
        fontWeight: '800',
    },
    cardAddress: {
        fontSize: 13,
        fontWeight: '500',
        opacity: 0.8,
        marginBottom: 16,
    },
    footerBlock: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 12,
    },
    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    cardMeta: {
        fontSize: 12,
        fontWeight: '500',
        opacity: 0.7,
    },
    cardNotice: {
        fontSize: 12,
        lineHeight: 18,
        marginTop: 12,
        opacity: 0.88,
    },
});
