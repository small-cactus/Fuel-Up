import React, { memo, useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassContainer, GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';

import PredictedPriceFlag from './PredictedPriceFlag';
import {
    getFuelGradeMeta,
    normalizeFuelGrade,
    resolveQuotePriceForFuelGrade,
} from '../lib/fuelGrade';

const BEST_PRICE_LIGHT = '#007AFF';
const BEST_PRICE_DARK = '#11f050ff';
const GO_BUTTON_GREEN = '#34C759';
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

function truncateStationTitle(title, { hasRating }) {
    if (typeof title !== 'string') {
        return title;
    }

    // Slightly looser limits than the old maximalist layout because the
    // header row no longer has to budget space for the prominent
    // "ESTIMATED" pill — it's now an inline "info" glyph.
    const maxLength = hasRating ? 22 : 30;

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
    themeColors,
    rank,
    glassTintColor,
    fuelGrade = 'regular',
    onNavigatePress,
}) {
    const selectedFuelGrade = normalizeFuelGrade(fuelGrade);
    const selectedGradeMeta = getFuelGradeMeta(selectedFuelGrade);
    const selectedGradePrice = resolveQuotePriceForFuelGrade(quote, selectedFuelGrade);

    const bestPriceColor = isDark ? BEST_PRICE_DARK : BEST_PRICE_LIGHT;
    const hasFailureState = !quote && Boolean(errorMsg);
    const title = hasFailureState ? 'No Prices Returned' : quote?.stationName || 'Cheapest Nearby';
    const showRating = quote?.rating != null;
    const displayTitle = truncateStationTitle(title, { hasRating: showRating });
    const subtitle = quote ? formatDistance(quote?.distanceMiles) : null;
    const canNavigate = Boolean(
        !hasFailureState &&
        typeof onNavigatePress === 'function' &&
        Number.isFinite(Number(quote?.latitude)) &&
        Number.isFinite(Number(quote?.longitude))
    );

    const handleNavigatePress = useCallback(() => {
        if (typeof onNavigatePress === 'function' && quote) {
            onNavigatePress(quote);
        }
    }, [onNavigatePress, quote]);

    return (
        <GlassContainer spacing={0} style={styles.cardGroup}>
            <GlassView
                style={styles.card}
                tintColor={glassTintColor ?? (isDark ? '#101010ff' : '#FFFFFF')}
                glassEffectStyle={CARD_GLASS_EFFECT_STYLE}
            >
                <View style={styles.contentBlock}>
                    {/* Go button — absolute top-right, Apple Maps style */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={canNavigate ? `Navigate to ${quote?.stationName || 'station'}` : 'Navigate (unavailable)'}
                        accessibilityState={{ disabled: !canNavigate }}
                        onPress={handleNavigatePress}
                        disabled={!canNavigate}
                        hitSlop={8}
                        style={({ pressed }) => [
                            styles.goPressable,
                            {
                                opacity: !canNavigate ? 0.45 : (pressed ? 0.78 : 1),
                            },
                        ]}
                    >
                        <View style={styles.goButton}>
                            <Text style={styles.goButtonText} numberOfLines={1}>Go</Text>
                        </View>
                    </Pressable>

                    <View style={styles.headerRow}>
                        <View style={styles.headerContent}>
                            <View style={styles.titleRow}>
                                {rank ? (
                                    <View style={[styles.rankBadge, { backgroundColor: themeColors.text }]}>
                                        <Text style={[styles.rankText, { color: themeColors.background }]}>#{rank}</Text>
                                    </View>
                                ) : null}
                                <Text
                                    style={[styles.cardTitle, { color: themeColors.text }]}
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.85}
                                    allowFontScaling={false}
                                >
                                    {displayTitle}
                                </Text>
                                {showRating ? (
                                    <View style={styles.ratingRow}>
                                        <SymbolView name="star.fill" size={12} tintColor="#FFB800" />
                                        <Text
                                            style={[styles.ratingText, { color: themeColors.text }]}
                                            numberOfLines={1}
                                            adjustsFontSizeToFit
                                            minimumFontScale={0.85}
                                            allowFontScaling={false}
                                        >
                                            {quote.rating.toFixed(1)}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                        </View>
                        {isRefreshing ? <ActivityIndicator size="small" color={themeColors.text} /> : null}
                    </View>

                    <View style={styles.priceBlock}>
                        <View style={styles.gradeLabelRow}>
                            <Text
                                style={[styles.gradeLabelText, { color: themeColors.text }]}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.85}
                                allowFontScaling={false}
                            >
                                {selectedGradeMeta.label}
                            </Text>
                            <Text
                                style={[styles.gradeOctaneText, { color: themeColors.text }]}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.85}
                                allowFontScaling={false}
                            >
                                {selectedGradeMeta.octane}
                            </Text>
                            <PredictedPriceFlag
                                validation={quote?.validation}
                                isDark={isDark}
                                themeColors={themeColors}
                            />
                        </View>
                        <Text
                            style={[styles.cardPrice, { color: bestPriceColor }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.7}
                            allowFontScaling={false}
                        >
                            ${formatPrice(selectedGradePrice)}
                            <Text style={[styles.perGallon, { color: themeColors.text }]}>{' '}/ gal</Text>
                        </Text>
                    </View>

                    <Text
                        style={[styles.cardAddress, { color: themeColors.text }]}
                        numberOfLines={2}
                    >
                        {quote?.address || (hasFailureState ? 'Try again once live provider data is available.' : 'Checking nearby providers')}
                    </Text>

                    <View style={styles.footerRow}>
                        <View style={styles.metaBlock}>
                            <Text
                                style={[styles.cardMeta, { color: themeColors.text }]}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.85}
                                allowFontScaling={false}
                            >
                                {subtitle || (hasFailureState ? 'No prices returned' : 'Loading your location')}
                            </Text>

                            {quote?.updatedAt && (
                                <>
                                    <Text
                                        style={[styles.metaSeparator, { color: themeColors.text }]}
                                        allowFontScaling={false}
                                    >
                                        ·
                                    </Text>
                                    <SymbolView
                                        name="clock.fill"
                                        size={10}
                                        tintColor={themeColors.text}
                                        style={styles.metaClockIcon}
                                    />
                                    <Text
                                        style={[styles.cardMeta, { color: themeColors.text }]}
                                        numberOfLines={1}
                                        adjustsFontSizeToFit
                                        minimumFontScale={0.85}
                                        allowFontScaling={false}
                                    >
                                        {formatRelativeTime(quote.updatedAt)}
                                    </Text>
                                </>
                            )}
                        </View>
                    </View>

                    {errorMsg ? (
                        <Text style={[styles.cardNotice, { color: themeColors.text }]}>{errorMsg}</Text>
                    ) : null}
                </View>
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
        borderRadius: 28,
        overflow: 'hidden',
        shadowColor: 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    contentBlock: {
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 14,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 8,
    },
    headerContent: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
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
    rankBadge: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 9,
    },
    rankText: {
        fontSize: 12,
        fontWeight: '800',
    },
    cardTitle: {
        fontSize: 17,
        fontWeight: '700',
        flexShrink: 1,
        minWidth: 0,
        letterSpacing: -0.3,
    },
    priceBlock: {
        marginBottom: 6,
    },
    gradeLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 1,
    },
    gradeLabelText: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        opacity: 0.55,
    },
    gradeOctaneText: {
        fontSize: 10,
        fontWeight: '500',
        opacity: 0.4,
        letterSpacing: 0.2,
    },
    cardPrice: {
        fontSize: 28,
        fontWeight: '800',
        letterSpacing: -0.7,
    },
    perGallon: {
        fontSize: 13,
        fontWeight: '500',
        opacity: 0.45,
        letterSpacing: -0.1,
    },
    cardAddress: {
        fontSize: 13,
        fontWeight: '500',
        opacity: 0.68,
        marginBottom: 10,
        lineHeight: 17,
    },
    // The footer row hosts the meta info (distance · time) on the left and
    // the Navigate pill on the right. Combining these into a single row
    // eliminates the dead space a separate button row used to create and
    // keeps the card visually compact.
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    metaBlock: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    metaSeparator: {
        fontSize: 12,
        fontWeight: '600',
        opacity: 0.45,
        marginHorizontal: 1,
    },
    metaClockIcon: {
        opacity: 0.6,
        marginLeft: 2,
    },
    cardMeta: {
        fontSize: 12,
        fontWeight: '500',
        opacity: 0.65,
    },
    cardNotice: {
        fontSize: 12,
        lineHeight: 18,
        marginTop: 10,
        marginBottom: 2,
        opacity: 0.88,
    },
    // Apple Maps-style "Go" pill — absolute top-right of the card content area
    goPressable: {
        position: 'absolute',
        top: 18,
        right: 18,
        zIndex: 10,
    },
    goButton: {
        backgroundColor: GO_BUTTON_GREEN,
        paddingVertical: 14,
        paddingHorizontal: 22,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    goButtonText: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.2,
    },
});
