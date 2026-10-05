import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Animated, StyleSheet, Text, View, ScrollView, Dimensions, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ThemeContext';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import ObservedPriceChart from '../../src/screens/trends/ObservedPriceChart';
import { buildDisplayTrendSeries } from '../../src/screens/trends/displayTrendSeries';
import TrendScopeControl from '../../src/screens/trends/TrendScopeControl';
import NationalTrendPrices from '../../src/screens/trends/NationalTrendPrices';
import useNationalLeaderboard from '../../src/screens/trends/useNationalLeaderboard';
import TrendLeaderboard from '../../src/screens/trends/TrendLeaderboard';
import TrendLeaderboardSkeleton from '../../src/screens/trends/TrendLeaderboardSkeleton';
import { getTrendDirectionFromData } from '../../src/screens/trends/trendDirection';
import useNetworkStatus from '../../src/lib/useNetworkStatus';
import { buildTrendRequestKey } from '../../src/services/fuel/trends';
import useTrendData from '../../src/screens/trends/useTrendData';
import { useAppState } from '../../src/AppStateContext';
import { usePreferences } from '../../src/PreferencesContext';
import TopCanopy from '../../src/components/TopCanopy';
import FuelUpHeaderLogo from '../../src/components/FuelUpHeaderLogo';
import { getFuelGradeMeta, normalizeFuelGrade } from '../../src/lib/fuelGrade';
import { buildResolvedFuelSearchContext } from '../../src/lib/fuelSearchState';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 220;
const TOP_CANOPY_HEIGHT = 44;
const TREND_BACKGROUND_GRADIENT_STRENGTH = 10; // 0 = off, 1 = default, >1 = stronger
const TREND_BACKGROUND_GRADIENT_SPREAD = 0.35; // 0 = tighter/closer, 1 = wider/spread out

const COLORS = {
    GREEN: '#51CF66',
    RED: '#FF6B6B',
    GREEN_DARK: '#40C057',
    RED_DARK: '#FA5252',
    GRADIENT_GREEN_LIGHT: '#51CF66',
    GRADIENT_GREEN_DARK: '#40C057',
    GRADIENT_RED_LIGHT: '#ffa0a0ff',
    GRADIENT_RED_DARK: '#5b0e0eff',
    GRADIENT_GREEN_ALPHA_LIGHT: 1,
    GRADIENT_GREEN_ALPHA_DARK: 1,
    GRADIENT_RED_ALPHA_LIGHT: 1,
    GRADIENT_RED_ALPHA_DARK: 1,
};

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

function hexToRgba(hex, alpha) {
    const normalized = hex.replace('#', '');
    const fullHex = normalized.length === 3
        ? normalized.split('').map(c => `${c}${c}`).join('')
        : normalized;
    const r = parseInt(fullHex.slice(0, 2), 16);
    const g = parseInt(fullHex.slice(2, 4), 16);
    const b = parseInt(fullHex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

function formatRelativeTime(updatedAt) {
    if (!updatedAt) return '—';
    const updated = new Date(updatedAt).getTime();
    if (!Number.isFinite(updated)) return '—';

    const diffMins = Math.floor((Date.now() - updated) / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

function formatTrendDeltaPercent(delta, baselinePrice) {
    const numericDelta = Number(delta);
    const numericBaseline = Number(baselinePrice);

    if (!Number.isFinite(numericDelta) || !Number.isFinite(numericBaseline) || numericBaseline <= 0) {
        return '—';
    }

    const percentChange = (numericDelta / numericBaseline) * 100;
    const prefix = percentChange > 0 ? '+' : '';

    return `${prefix}${percentChange.toFixed(1)}%`;
}

function formatTrendAxisLabel(dateValue, rangeStartValue, rangeEndValue) {
    const date = new Date(dateValue);
    const rangeStart = new Date(rangeStartValue);
    const rangeEnd = new Date(rangeEndValue);

    if (
        !Number.isFinite(date.getTime()) ||
        !Number.isFinite(rangeStart.getTime()) ||
        !Number.isFinite(rangeEnd.getTime())
    ) {
        return '—';
    }

    const isSingleDayRange = (
        date.toDateString() === rangeStart.toDateString() &&
        rangeStart.toDateString() === rangeEnd.toDateString()
    );

    if (isSingleDayRange) {
        return date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
        });
    }

    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    });
}

function buildTrendBackgroundGradientColors({ direction, isDark }) {
    if (direction === 'lower') {
        const hex = isDark ? COLORS.GRADIENT_GREEN_DARK : COLORS.GRADIENT_GREEN_LIGHT;
        const baseAlpha = isDark ? COLORS.GRADIENT_GREEN_ALPHA_DARK : COLORS.GRADIENT_GREEN_ALPHA_LIGHT;
        const alpha = baseAlpha * TREND_BACKGROUND_GRADIENT_STRENGTH;
        return [hexToRgba(hex, alpha), hexToRgba(hex, 0)];
    }

    if (direction === 'higher') {
        const hex = isDark ? COLORS.GRADIENT_RED_DARK : COLORS.GRADIENT_RED_LIGHT;
        const baseAlpha = isDark ? COLORS.GRADIENT_RED_ALPHA_DARK : COLORS.GRADIENT_RED_ALPHA_LIGHT;
        const alpha = baseAlpha * TREND_BACKGROUND_GRADIENT_STRENGTH;
        return [hexToRgba(hex, alpha), hexToRgba(hex, 0)];
    }

    return ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'];
}

function areGradientColorSetsEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }

    return left.every((color, index) => color === right[index]);
}

export default function TrendsScreen() {
    const insets = useSafeAreaInsets();
    const { faultsEnabled } = useNetworkStatus();
    const [priceScope, setPriceScope] = useState('local');
    const { isDark, themeColors } = useTheme();
    const {
        fuelResetToken,
        manualLocationOverride,
        resolvedFuelSearchContext,
        setResolvedFuelSearchContext,
    } = useAppState();
    const {
        normalizedFuelSearchPreferences,
    } = usePreferences();
    const selectedFuelGrade = normalizeFuelGrade(normalizedFuelSearchPreferences.preferredOctane);
    const searchRadiusMiles = normalizedFuelSearchPreferences.searchRadiusMiles;
    const preferredProvider = normalizedFuelSearchPreferences.preferredProvider;
    const minimumRating = normalizedFuelSearchPreferences.minimumRating;
    const preferredBrands = normalizedFuelSearchPreferences.preferredBrands;
    const fuelMemberships = normalizedFuelSearchPreferences.fuelMemberships;
    const requiresE85 = normalizedFuelSearchPreferences.requiresE85;
    const selectedFuelGradeMeta = getFuelGradeMeta(selectedFuelGrade);
    const resolvedManualOrigin = useMemo(() => {
        const latitude = Number(manualLocationOverride?.latitude);
        const longitude = Number(manualLocationOverride?.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }

        return {
            latitude,
            longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
            locationSource: 'manual',
        };
    }, [manualLocationOverride]);
    const sharedSearchOrigin = useMemo(() => {
        if (resolvedManualOrigin) {
            return resolvedManualOrigin;
        }

        const latitude = Number(resolvedFuelSearchContext?.latitude);
        const longitude = Number(resolvedFuelSearchContext?.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }

        return {
            latitude,
            longitude,
            latitudeDelta: Number(resolvedFuelSearchContext?.latitudeDelta) || 0.05,
            longitudeDelta: Number(resolvedFuelSearchContext?.longitudeDelta) || 0.05,
            locationSource: resolvedFuelSearchContext?.locationSource || 'device',
        };
    }, [resolvedFuelSearchContext, resolvedManualOrigin]);
    const currentTrendRequestKey = useMemo(() => (
        sharedSearchOrigin
            ? buildTrendRequestKey({
                latitude: sharedSearchOrigin.latitude,
                longitude: sharedSearchOrigin.longitude,
                fuelType: selectedFuelGrade,
                radiusMiles: searchRadiusMiles,
                preferredProvider,
                minimumRating,
                preferredBrands,
                fuelMemberships,
                requiresE85,
            })
            : ''
    ), [
        minimumRating,
        preferredBrands,
        fuelMemberships,
        requiresE85,
        preferredProvider,
        searchRadiusMiles,
        selectedFuelGrade,
        sharedSearchOrigin,
    ]);
    const commitResolvedSearchOrigin = useCallback((origin, locationSource) => {
        const nextContext = buildResolvedFuelSearchContext({
            origin,
            locationSource,
            fuelGrade: selectedFuelGrade,
            radiusMiles: searchRadiusMiles,
            preferredProvider,
            minimumRating,
            preferredBrands,
            fuelMemberships,
            requiresE85,
        });

        if (nextContext) {
            setResolvedFuelSearchContext(nextContext);
        }
    }, [
        minimumRating,
        preferredBrands,
        fuelMemberships,
        requiresE85,
        preferredProvider,
        searchRadiusMiles,
        selectedFuelGrade,
        setResolvedFuelSearchContext,
    ]);

    const { data: displayTrendData, loading, refreshing, error: trendError, onPullToRefresh } = useTrendData({
        enabled: priceScope === 'local',
        currentRequestKey: currentTrendRequestKey,
        origin: sharedSearchOrigin,
        fuelGrade: selectedFuelGrade,
        radiusMiles: searchRadiusMiles,
        preferredProvider,
        minimumRating,
        preferredBrands,
        fuelMemberships,
        requiresE85,
        resetToken: fuelResetToken,
        commitOrigin: commitResolvedSearchOrigin,
    });
    const national = useNationalLeaderboard({ enabled: priceScope === 'national', fuelType: selectedFuelGrade, requiresE85, resetToken: fuelResetToken });
    const wasFaulted = useRef(faultsEnabled);
    const refreshAfterFault = useRef(null);
    refreshAfterFault.current = priceScope === 'national' ? national.onRefresh : onPullToRefresh;
    useEffect(() => {
        const recovering = wasFaulted.current && !faultsEnabled;
        wasFaulted.current = faultsEnabled;
        if (!recovering) return;
        const timer = setTimeout(() => refreshAfterFault.current?.(), 0);
        return () => clearTimeout(timer);
    }, [faultsEnabled]);
    const [activeGradientColors, setActiveGradientColors] = useState(() => buildTrendBackgroundGradientColors({
        direction: getTrendDirectionFromData(displayTrendData), isDark,
    }));
    const [incomingGradientColors, setIncomingGradientColors] = useState(null);
    const gradientFadeOpacity = useRef(new Animated.Value(1)).current;
    const heroTrendData = faultsEnabled ? null : priceScope === 'local' ? displayTrendData : national.trendData;
    const chartLoading = faultsEnabled || (priceScope === 'local' ? loading : national.loading);
    const chartPoints = useMemo(() => buildDisplayTrendSeries(
        heroTrendData?.averagePricesByDay, { latestObservedAverage: heroTrendData?.latestObservedAverage }
    ), [heroTrendData]);
    const hasHeroTrendData = chartPoints.length > 0;
    const gradientSourceData = heroTrendData || null;
    const heroTrendDirection = useMemo(
        () => getTrendDirectionFromData(heroTrendData || null),
        [heroTrendData]
    );
    const primaryTrendColor = useMemo(() => {
        if (heroTrendDirection === 'lower') {
            return COLORS.GREEN;
        }

        if (heroTrendDirection === 'higher') {
            return COLORS.RED;
        }

        return themeColors.text;
    }, [heroTrendDirection, themeColors.text]);
    const targetGradientColors = useMemo(() => (
        buildTrendBackgroundGradientColors({
            direction: getTrendDirectionFromData(gradientSourceData),
            isDark,
        })
    ), [gradientSourceData, isDark]);

    useEffect(() => {
        if (areGradientColorSetsEqual(activeGradientColors, targetGradientColors)) {
            setIncomingGradientColors(null);
            gradientFadeOpacity.setValue(1);
            return;
        }

        setIncomingGradientColors(targetGradientColors);
        gradientFadeOpacity.setValue(0);

        const animation = Animated.timing(gradientFadeOpacity, {
            toValue: 1,
            duration: 650,
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (!finished) {
                return;
            }

            setActiveGradientColors(targetGradientColors);
            setIncomingGradientColors(null);
            gradientFadeOpacity.setValue(1);
        });
        return () => animation.stop();
    }, [
        activeGradientColors,
        gradientFadeOpacity,
        targetGradientColors,
    ]);

    const canopyEdgeLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const gradientSpread = clamp01(TREND_BACKGROUND_GRADIENT_SPREAD);
    const numericTextStyle = styles.numericRounded;
    const leaderboardUpdatedLabel = useMemo(
        () => formatRelativeTime(displayTrendData?.leaderboardLatestReportedAt),
        [displayTrendData?.leaderboardLatestReportedAt]
    );
    const heroDeltaLabel = useMemo(() => {
        if (!heroTrendData?.overallTrend || heroTrendData.averagePricesByDay.length < 2) {
            return null;
        }

        return formatTrendDeltaPercent(
            heroTrendData.overallTrend.delta,
            heroTrendData.averagePricesByDay[0]?.price
        );
    }, [heroTrendData]);
    const darkModeWeightStyle = useMemo(() => ({
        heroSub: { fontWeight: isDark ? '600' : '700' },
        heroPrice: { fontWeight: isDark ? '700' : '800' },
        heroDelta: { fontWeight: isDark ? '600' : '700' },
        axisText: { fontWeight: isDark ? '500' : '600' },
        cardTitle: { fontWeight: isDark ? '700' : '800' },
        cardSubTitle: { fontWeight: isDark ? '400' : '500' },
        itemName: { fontWeight: isDark ? '600' : '700' },
        itemSub: { fontWeight: isDark ? '400' : '500' },
        itemVal: { fontWeight: isDark ? '700' : '800' },
        rankPrimary: { fontWeight: isDark ? '700' : '800' },
        rankSecondary: { fontWeight: isDark ? '500' : '600' },
        shift: { fontWeight: isDark ? '600' : '700' },
        emptyText: { fontWeight: isDark ? '400' : '500' },
    }), [isDark]);

    return (
        <View style={styles.container}>
            <View style={[styles.baseBackground, { backgroundColor: themeColors.background }]} />
            <ExpoLinearGradient
                pointerEvents="none"
                colors={activeGradientColors}
                start={{ x: 0, y: 0 }}
                end={{ x: gradientSpread, y: gradientSpread }}
                style={styles.topLeftTrendGradient}
            />
            {incomingGradientColors ? (
                <Animated.View
                    pointerEvents="none"
                    style={[styles.topLeftTrendGradient, { opacity: gradientFadeOpacity, zIndex: 2 }]}
                >
                    <ExpoLinearGradient
                        pointerEvents="none"
                        colors={incomingGradientColors}
                        start={{ x: 0, y: 0 }}
                        end={{ x: gradientSpread, y: gradientSpread }}
                        style={StyleSheet.absoluteFill}
                    />
                </Animated.View>
            ) : null}
            <View style={styles.foregroundLayer}>
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={{ paddingTop: insets.top + 44, paddingBottom: insets.bottom + 80 }}
                    showsVerticalScrollIndicator={false}
                    bounces={true}
                    refreshControl={(
                        <RefreshControl
                            refreshing={priceScope === 'national' ? national.refreshing : refreshing}
                            onRefresh={priceScope === 'national' ? national.onRefresh : onPullToRefresh}
                            tintColor={themeColors.text}
                            colors={[themeColors.text]}
                            progressBackgroundColor={isDark ? '#111111' : '#FFFFFF'}
                            progressViewOffset={topCanopyHeight + 8}
                        />
                    )}
                >
                    <View style={styles.contentWrap}>
                        <View style={styles.heroGraphPad}>
                            <Text style={[styles.heroSub, darkModeWeightStyle.heroSub, { color: themeColors.textOpacity }]}>
                                Reported {selectedFuelGradeMeta.label} {priceScope === 'national' ? 'National' : 'Local'} Average
                            </Text>
                            <View style={styles.heroPriceRow}>
                                <View style={styles.heroPriceValues}>
                                    {hasHeroTrendData ? <>
                                        <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={2} style={[styles.heroPrice, numericTextStyle, darkModeWeightStyle.heroPrice, { color: themeColors.text }]}>
                                            ${chartPoints.at(-1).price.toFixed(2)}
                                        </Text>
                                        {heroDeltaLabel ? <Text maxFontSizeMultiplier={2} style={[styles.heroDelta, numericTextStyle, darkModeWeightStyle.heroDelta, { color: primaryTrendColor }]}>
                                            {heroDeltaLabel}
                                        </Text> : null}
                                    </> : chartLoading ? <>
                                        <View style={[styles.heroPricePlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                                        <View style={[styles.heroDeltaPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]} />
                                    </> : <Text style={[styles.heroPrice, numericTextStyle, { color: themeColors.textOpacity }]}>—</Text>}
                                </View>
                                <TrendScopeControl value={priceScope} onChange={setPriceScope} isDark={isDark} themeColors={themeColors} />
                            </View>
                        </View>
                            {/* Display-only carry-forward; raw observations remain unchanged. */}
                            {hasHeroTrendData ? (
                                <View style={styles.heroGraphSection}>
                                    <ObservedPriceChart
                                        data={chartPoints}
                                        width={SCREEN_WIDTH}
                                        height={CHART_HEIGHT}
                                        isDark={isDark}
                                        trendColor={primaryTrendColor}
                                        topBleed={40}
                                    />

                                    <View style={styles.heroAxis}>
                                        <Text style={[styles.axisText, numericTextStyle, darkModeWeightStyle.axisText, { color: themeColors.textOpacity }]}>
                                            {formatTrendAxisLabel(
                                                chartPoints[0].date,
                                                chartPoints[0].date,
                                                chartPoints.at(-1).date
                                            )}
                                        </Text>
                                        <Text style={[styles.axisText, numericTextStyle, darkModeWeightStyle.axisText, { color: themeColors.textOpacity }]}>
                                            {formatTrendAxisLabel(
                                                chartPoints.at(-1).date,
                                                chartPoints[0].date,
                                                chartPoints.at(-1).date
                                            )}
                                        </Text>
                                    </View>
                                </View>
                            ) : chartLoading ? (
                                <View style={styles.heroGraphPlaceholderSection}>
                                    <View style={styles.heroChartPlaceholderWrap}>
                                        <View style={[styles.heroChartPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]} />
                                    </View>
                                    <View style={styles.heroAxis}>
                                        <View style={[styles.axisPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} />
                                        <View style={[styles.axisPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} />
                                    </View>
                                </View>
                            ) : null}

                            {priceScope === 'national' ? <>
                                {!chartLoading && !hasHeroTrendData && <Text style={[styles.emptyText, { color: themeColors.textOpacity }]}>{national.historyError || 'National price history will appear as reports arrive.'}</Text>}
                                <NationalTrendPrices {...national} loading={faultsEnabled || national.loading} gradeLabel={selectedFuelGradeMeta.label} isDark={isDark} themeColors={themeColors} />
                            </> : <View style={styles.contentPad}>
                                {/* 2. Leaderboard */}
                                {chartLoading ? <TrendLeaderboardSkeleton isDark={isDark} themeColors={themeColors} /> : displayTrendData?.leaderboard?.length > 0 && (
                                    <TrendLeaderboard
                                        stations={displayTrendData.leaderboard}
                                        gradeLabel={selectedFuelGradeMeta.label}
                                        updatedLabel={leaderboardUpdatedLabel}
                                        isDark={isDark}
                                        themeColors={themeColors}
                                    />
                                )}

                                {/* Empty/No Data Fallback */}
                                {!chartLoading && !displayTrendData?.averagePricesByDay?.length && !displayTrendData?.leaderboard?.length && (
                                    <View style={styles.emptyState}>
                                        <Text style={[styles.emptyText, darkModeWeightStyle.emptyText, { color: themeColors.textOpacity }]}>{trendError || 'Not enough historical data collected yet to render trends. Check back soon.'}</Text>
                                    </View>
                                )}
                            </View>}
                        </View>
                </ScrollView>

                <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />
                <View style={[styles.header, { paddingTop: insets.top }]}>
                    <FuelUpHeaderLogo isDark={isDark} />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative',
    },
    baseBackground: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 0,
    },
    topLeftTrendGradient: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
    foregroundLayer: {
        flex: 1,
        zIndex: 2,
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 10,
        zIndex: 10,
    },
    scrollView: {
        flex: 1,
    },
    contentWrap: {
        width: '100%',
    },
    heroGraphSection: {
        width: '100%',
        marginBottom: 8,
    },
    heroGraphPlaceholderSection: {
        width: '100%',
        marginBottom: 8,
    },
    heroGraphPad: {
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 0,
    },
    heroSub: {
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: -0.3,
        marginBottom: 4,
    },
    heroPriceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    heroPriceValues: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
    },
    heroPrice: {
        flexShrink: 1,
        fontSize: 42,
        fontWeight: '800',
        letterSpacing: -1.5,
        marginRight: 10,
    },
    heroDelta: {
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    heroPricePlaceholder: {
        width: 144,
        height: 42,
        borderRadius: 16,
        marginRight: 10,
    },
    heroDeltaPlaceholder: {
        width: 72,
        height: 20,
        borderRadius: 10,
    },
    heroChartPlaceholderWrap: {
        width: '100%',
        paddingHorizontal: 16,
        marginTop: 10,
    },
    heroChartPlaceholder: {
        width: '100%',
        height: CHART_HEIGHT - 12,
        borderRadius: 24,
    },
    heroAxis: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        marginTop: 4,
    },
    axisPlaceholder: {
        width: 56,
        height: 13,
        borderRadius: 7,
    },
    axisText: {
        fontSize: 13,
        fontWeight: '600',
    },
    contentPad: {
        padding: 16,
    },
    emptyState: {
        marginTop: 40,
        padding: 20,
        alignItems: 'center',
    },
    emptyText: {
        textAlign: 'center',
        fontSize: 15,
        fontWeight: '500',
        lineHeight: 22,
    },
    numericRounded: {
        fontFamily: 'ui-rounded',
    },
});
