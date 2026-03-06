import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StyleSheet, Text, View, ScrollView, Dimensions, ActivityIndicator, RefreshControl } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ThemeContext';
import * as Location from 'expo-location';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import * as d3Shape from 'd3-shape';
import * as d3Scale from 'd3-scale';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect } from 'expo-router';
import { fetchTrendData } from '../../src/services/fuel/trends';
import { usePreferences } from '../../src/PreferencesContext';
import TopCanopy from '../../src/components/TopCanopy';
import FuelUpHeaderLogo from '../../src/components/FuelUpHeaderLogo';
import ProgressiveBlurReveal from '../../src/components/ProgressiveBlurReveal';
import { getFuelGradeMeta, normalizeFuelGrade } from '../../src/lib/fuelGrade';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 220;
const TOP_CANOPY_HEIGHT = 44;
const VIEW_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const TREND_BACKGROUND_GRADIENT_STRENGTH = 10; // 0 = off, 1 = default, >1 = stronger
const TREND_BACKGROUND_GRADIENT_SPREAD = 0.35; // 0 = tighter/closer, 1 = wider/spread out

const cachedTrendDataByFuelType = {};
const lastTrendsScreenViewedAtMsByFuelType = {};

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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function ContainerlessAreaChart({ data, width, height, isDark, trendColor }) {
    if (!data || data.length === 0) return null;

    const margin = { top: 40, right: 0, bottom: 0, left: 0 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const xExtent = [0, data.length - 1];
    const yExtent = [
        Math.min(...data.map(d => d.price)) * 0.99, // slight bottom padding natively
        Math.max(...data.map(d => d.price)) * 1.01
    ];

    const xScale = d3Scale.scaleLinear()
        .domain(xExtent)
        .range([0, chartWidth]);

    const yScale = d3Scale.scaleLinear()
        .domain(yExtent)
        .range([chartHeight, 0]);

    const lineGenerator = d3Shape.line()
        .x((d, i) => xScale(i))
        .y(d => yScale(d.price))
        .curve(d3Shape.curveMonotoneX);

    const areaGenerator = d3Shape.area()
        .x((d, i) => xScale(i))
        .y0(chartHeight)
        .y1(d => yScale(d.price))
        .curve(d3Shape.curveMonotoneX);

    const pathData = lineGenerator(data);
    const areaData = areaGenerator(data);

    return (
        <View style={{ width, height, marginTop: -margin.top }}>
            <Svg width={width} height={height}>
                <Defs>
                    <SvgLinearGradient id="gradientTrend" x1="0%" y1="0%" x2="0%" y2="100%">
                        <Stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
                        <Stop offset="80%" stopColor={trendColor} stopOpacity={0.05} />
                        <Stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                    </SvgLinearGradient>
                </Defs>
                <Path d={areaData} fill="url(#gradientTrend)" x={margin.left} y={margin.top} />
                <Path d={pathData} fill="none" stroke={trendColor} strokeWidth={3} x={margin.left} y={margin.top} />
            </Svg>
        </View>
    );
}

export default function TrendsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { preferences } = usePreferences();
    const selectedFuelGrade = normalizeFuelGrade(preferences.preferredOctane);
    const selectedFuelGradeMeta = getFuelGradeMeta(selectedFuelGrade);
    const cachedTrendData = cachedTrendDataByFuelType[selectedFuelGrade] || null;
    const [loading, setLoading] = useState(!cachedTrendData);
    const [refreshing, setRefreshing] = useState(false);
    const [trendData, setTrendData] = useState(cachedTrendData);
    const [shouldRunReveal, setShouldRunReveal] = useState(false);
    const isMountedRef = useRef(true);
    const selectedFuelGradeRef = useRef(selectedFuelGrade);
    const activeFetchRef = useRef({
        fuelGrade: null,
        promise: null,
    });

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        selectedFuelGradeRef.current = selectedFuelGrade;
    }, [selectedFuelGrade]);

    useEffect(() => {
        const nextCachedData = cachedTrendDataByFuelType[selectedFuelGrade] || null;
        setTrendData(nextCachedData);
        setLoading(!nextCachedData);
    }, [selectedFuelGrade]);

    const loadTrendData = useCallback(({ showLoading = false } = {}) => {
        const requestFuelGrade = selectedFuelGrade;

        if (
            activeFetchRef.current.promise &&
            activeFetchRef.current.fuelGrade === requestFuelGrade
        ) {
            return activeFetchRef.current.promise;
        }

        if (showLoading && isMountedRef.current) {
            setLoading(true);
        }

        const request = (async () => {
            try {
                let permission = await Location.getForegroundPermissionsAsync();
                if (permission.status !== 'granted') {
                    permission = await Location.requestForegroundPermissionsAsync();
                }

                let loc = null;
                if (permission.status === 'granted') {
                    loc = await Location.getCurrentPositionAsync({});
                }

                const lat = loc?.coords?.latitude || 37.3346;
                const lng = loc?.coords?.longitude || -122.009;
                const data = await fetchTrendData({
                    latitude: lat,
                    longitude: lng,
                    fuelType: requestFuelGrade,
                });

                cachedTrendDataByFuelType[requestFuelGrade] = data;

                if (isMountedRef.current) {
                    if (selectedFuelGradeRef.current === requestFuelGrade) {
                        setTrendData(data);
                    }
                }
            } catch (err) {
                console.warn('Error loading trends data', err);
            } finally {
                if (isMountedRef.current) {
                    if (selectedFuelGradeRef.current === requestFuelGrade) {
                        setLoading(false);
                    }
                }
                if (activeFetchRef.current.fuelGrade === requestFuelGrade) {
                    activeFetchRef.current = {
                        fuelGrade: null,
                        promise: null,
                    };
                }
            }
        })();

        activeFetchRef.current = {
            fuelGrade: requestFuelGrade,
            promise: request,
        };
        return request;
    }, [selectedFuelGrade]);

    useFocusEffect(
        useCallback(() => {
            const now = Date.now();
            const cachedDataForFuelType = cachedTrendDataByFuelType[selectedFuelGrade] || null;
            const lastViewedAtForFuelType = lastTrendsScreenViewedAtMsByFuelType[selectedFuelGrade] || 0;
            const hasExpired = (now - lastViewedAtForFuelType) > VIEW_REFRESH_INTERVAL_MS;
            const shouldFetch = !cachedDataForFuelType || hasExpired;

            lastTrendsScreenViewedAtMsByFuelType[selectedFuelGrade] = now;

            if (cachedDataForFuelType && trendData !== cachedDataForFuelType) {
                setTrendData(cachedDataForFuelType);
            }

            if (shouldFetch) {
                void loadTrendData({ showLoading: !cachedDataForFuelType });
            }
        }, [loadTrendData, selectedFuelGrade, trendData])
    );

    useFocusEffect(
        useCallback(() => {
            setShouldRunReveal(true);

            return () => {
                setShouldRunReveal(false);
            };
        }, [])
    );

    const onPullToRefresh = useCallback(() => {
        setRefreshing(true);
        lastTrendsScreenViewedAtMsByFuelType[selectedFuelGrade] = Date.now();

        const refreshStartedAt = Date.now();
        void (async () => {
            try {
                await loadTrendData({ showLoading: false });
            } finally {
                const elapsed = Date.now() - refreshStartedAt;
                if (elapsed < 550) {
                    await sleep(550 - elapsed);
                }
                if (isMountedRef.current) {
                    setRefreshing(false);
                }
            }
        })();
    }, [loadTrendData, selectedFuelGrade]);

    const isPriceDrop = trendData?.overallTrend?.isDecrease;
    // Better = Green, Worse = Red
    const primaryTrendColor = isPriceDrop ? COLORS.GREEN : COLORS.RED;
    const secondaryTrendColor = isPriceDrop ? COLORS.GREEN_DARK : COLORS.RED_DARK;

    const todayTrendDirection = useMemo(() => {
        const pricesByDay = trendData?.averagePricesByDay;
        if (!pricesByDay || pricesByDay.length < 2) return null;
        const todayPrice = pricesByDay[pricesByDay.length - 1].price;
        const yesterdayPrice = pricesByDay[pricesByDay.length - 2].price;
        if (todayPrice < yesterdayPrice) return 'lower';
        if (todayPrice > yesterdayPrice) return 'higher';
        return 'flat';
    }, [trendData?.averagePricesByDay]);

    const trendBackgroundGradientColors = useMemo(() => {
        if (todayTrendDirection === 'lower') {
            const hex = isDark ? COLORS.GRADIENT_GREEN_DARK : COLORS.GRADIENT_GREEN_LIGHT;
            const baseAlpha = isDark ? COLORS.GRADIENT_GREEN_ALPHA_DARK : COLORS.GRADIENT_GREEN_ALPHA_LIGHT;
            const alpha = baseAlpha * TREND_BACKGROUND_GRADIENT_STRENGTH;
            return [hexToRgba(hex, alpha), hexToRgba(hex, 0)];
        }
        if (todayTrendDirection === 'higher') {
            const hex = isDark ? COLORS.GRADIENT_RED_DARK : COLORS.GRADIENT_RED_LIGHT;
            const baseAlpha = isDark ? COLORS.GRADIENT_RED_ALPHA_DARK : COLORS.GRADIENT_RED_ALPHA_LIGHT;
            const alpha = baseAlpha * TREND_BACKGROUND_GRADIENT_STRENGTH;
            return [hexToRgba(hex, alpha), hexToRgba(hex, 0)];
        }
        return ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'];
    }, [isDark, todayTrendDirection]);

    const glassTintColor = isDark ? '#101010ff' : '#FFFFFF';
    const canopyEdgeLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const gradientSpread = clamp01(TREND_BACKGROUND_GRADIENT_SPREAD);
    const numericTextStyle = styles.numericRounded;
    const leaderboardUpdatedLabel = useMemo(
        () => formatRelativeTime(trendData?.leaderboardLastChangedAt),
        [trendData?.leaderboardLastChangedAt]
    );
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
                colors={trendBackgroundGradientColors}
                start={{ x: 0, y: 0 }}
                end={{ x: gradientSpread, y: gradientSpread }}
                style={styles.topLeftTrendGradient}
            />
            <View style={styles.foregroundLayer}>
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={{ paddingTop: insets.top + 44, paddingBottom: insets.bottom + 80 }}
                    showsVerticalScrollIndicator={false}
                    bounces={true}
                    refreshControl={(
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onPullToRefresh}
                            tintColor={themeColors.text}
                            colors={[themeColors.text]}
                            progressBackgroundColor={isDark ? '#111111' : '#FFFFFF'}
                            progressViewOffset={topCanopyHeight + 8}
                        />
                    )}
                >
                    {loading ? (
                        <View style={{ marginTop: 100 }}>
                            <ActivityIndicator color={themeColors.text} />
                        </View>
                    ) : (
                        <View style={styles.contentWrap}>
                            {/* 1. Containerless Area Chart (Bleeding Edges) */}
                            {trendData?.averagePricesByDay?.length > 1 && (
                                <View style={styles.heroGraphSection}>
                                    <View style={styles.heroGraphPad}>
                                        <Text style={[styles.heroSub, darkModeWeightStyle.heroSub, { color: themeColors.textOpacity }]}>
                                            Your {selectedFuelGradeMeta.label} Local Average
                                        </Text>
                                        <View style={styles.heroPriceRow}>
                                            <Text style={[styles.heroPrice, numericTextStyle, darkModeWeightStyle.heroPrice, { color: themeColors.text }]}>
                                                ${trendData.averagePricesByDay[trendData.averagePricesByDay.length - 1].price.toFixed(2)}
                                            </Text>
                                            <Text style={[styles.heroDelta, numericTextStyle, darkModeWeightStyle.heroDelta, { color: primaryTrendColor }]}>
                                                {trendData.overallTrend.delta > 0 ? '+' : ''}{trendData.overallTrend.delta.toFixed(2)}¢
                                            </Text>
                                        </View>
                                    </View>

                                    <ContainerlessAreaChart
                                        data={trendData.averagePricesByDay}
                                        width={SCREEN_WIDTH}
                                        height={CHART_HEIGHT}
                                        isDark={isDark}
                                        trendColor={primaryTrendColor}
                                    />

                                    <View style={styles.heroAxis}>
                                        <Text style={[styles.axisText, numericTextStyle, darkModeWeightStyle.axisText, { color: themeColors.textOpacity }]}>
                                            {new Date(trendData.averagePricesByDay[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                        </Text>
                                        <Text style={[styles.axisText, numericTextStyle, darkModeWeightStyle.axisText, { color: themeColors.textOpacity }]}>
                                            {new Date(trendData.averagePricesByDay[trendData.averagePricesByDay.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                        </Text>
                                    </View>
                                </View>
                            )}

                            <View style={styles.contentPad}>
                                {/* 2. Leaderboard */}
                                {trendData?.leaderboard?.length > 0 && (
                                    <GlassView
                                        style={styles.glassCard}
                                        glassEffectStyle="regular"
                                        tintColor={glassTintColor}
                                    >
                                        <View style={styles.cardHeaderRow}>
                                            <Text style={[styles.cardTitle, darkModeWeightStyle.cardTitle, { color: themeColors.text }]}>
                                                {selectedFuelGradeMeta.label} Leaderboard
                                            </Text>
                                            <Text style={[styles.cardMeta, numericTextStyle, darkModeWeightStyle.itemSub, { color: themeColors.textOpacity }]}>
                                                Updated {leaderboardUpdatedLabel}
                                            </Text>
                                        </View>
                                        {trendData.leaderboard.map((st, idx) => {
                                            const rankLabel = idx === 0 ? '1st' : idx === 1 ? '2nd' : idx === 2 ? '3rd' : `${idx + 1}th`;
                                            const medalColor = idx === 0 ? themeColors.text : idx === 1 ? '#8f8f8fff' : idx === 2 ? '#CD7F32' : 'transparent';

                                            const shift = st.rankShift;
                                            const shiftSymbol = shift > 0 ? 'arrow.up' : shift < 0 ? 'arrow.down' : null;
                                            const shiftText = shift === 0 ? '—' : `${Math.abs(shift)}`;
                                            const shiftColor = shift > 0 ? COLORS.GREEN : shift < 0 ? COLORS.RED : themeColors.textOpacity;

                                            return (
                                                <View key={st.stationId} style={[styles.listItem, idx > 0 && { borderTopWidth: 1, borderTopColor: isDark ? '#333' : '#EEE' }]}>
                                                    <View style={styles.listTextCol}>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                                                            <Text style={[styles.itemName, darkModeWeightStyle.itemName, { color: themeColors.text }]}>{st.name || 'Unknown Station'}</Text>
                                                            {idx <= 2 ? (
                                                                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                                                                    <SymbolView
                                                                        name="laurel.leading"
                                                                        tintColor={medalColor}
                                                                        size={30}
                                                                        resizeMode="scaleAspectFit"
                                                                        type="monochrome"
                                                                    />
                                                                    <Text style={[numericTextStyle, darkModeWeightStyle.rankPrimary, {
                                                                        color: medalColor,
                                                                        fontSize: 18,
                                                                        marginHorizontal: 0
                                                                    }]}>
                                                                        {rankLabel}
                                                                    </Text>
                                                                    <SymbolView
                                                                        name="laurel.trailing"
                                                                        tintColor={medalColor}
                                                                        size={30}
                                                                        resizeMode="scaleAspectFit"
                                                                        type="monochrome"
                                                                    />
                                                                </View>
                                                            ) : (
                                                                <Text style={[numericTextStyle, darkModeWeightStyle.rankSecondary, { color: themeColors.textOpacity, fontSize: 13, marginLeft: 8 }]}>
                                                                    {rankLabel}
                                                                </Text>
                                                            )}
                                                        </View>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                                            <Text style={[styles.itemSub, darkModeWeightStyle.itemSub, { color: themeColors.textOpacity }]}>{st.address?.split(',')[0]}</Text>
                                                            {st.distanceMiles != null && (
                                                                <>
                                                                    <Text style={[styles.itemSub, darkModeWeightStyle.itemSub, { color: themeColors.textOpacity, marginHorizontal: 6 }]}>•</Text>
                                                                    <SymbolView
                                                                        name="car.fill"
                                                                        tintColor={themeColors.textOpacity}
                                                                        size={18}
                                                                        resizeMode="scaleAspectFit"
                                                                        type="monochrome"
                                                                        style={{ marginRight: 4 }}
                                                                    />
                                                                    <Text style={[styles.itemSub, numericTextStyle, darkModeWeightStyle.itemSub, { color: themeColors.textOpacity }]}>
                                                                        {st.distanceMiles.toFixed(1)} mi
                                                                    </Text>
                                                                </>
                                                            )}
                                                        </View>
                                                    </View>
                                                    <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                                                        <Text style={[styles.itemVal, numericTextStyle, darkModeWeightStyle.itemVal, { color: themeColors.text }]}>
                                                            ${st.latestPrice.toFixed(2)}
                                                        </Text>
                                                        <View style={styles.shiftRow}>
                                                            {shiftSymbol ? (
                                                                <SymbolView
                                                                    name={shiftSymbol}
                                                                    tintColor={shiftColor}
                                                                    size={13}
                                                                    weight="bold"
                                                                    resizeMode="scaleAspectFit"
                                                                    type="monochrome"
                                                                    style={styles.shiftSymbol}
                                                                />
                                                            ) : null}
                                                            <Text style={[numericTextStyle, darkModeWeightStyle.shift, { fontSize: 13, color: shiftColor }]}>
                                                                {shiftText}
                                                            </Text>
                                                        </View>
                                                    </View>
                                                </View>
                                            );
                                        })}
                                    </GlassView>
                                )}

                                {/* 3. Competitor Clusters */}
                                {trendData?.competitorClusters?.length > 0 && (
                                    <GlassView
                                        style={[styles.glassCard, { marginTop: 16 }]}
                                        glassEffectStyle="regular"
                                        tintColor={glassTintColor}
                                    >
                                        <Text style={[styles.cardTitle, darkModeWeightStyle.cardTitle, { color: themeColors.text, marginBottom: 4 }]}>Fierce Competitors</Text>
                                        <Text style={[styles.cardSubTitle, darkModeWeightStyle.cardSubTitle, { color: themeColors.textOpacity, marginBottom: 16 }]}>Stations battling on the same block</Text>

                                        {trendData.competitorClusters.map((cluster, idx) => (
                                            <View key={`cluster-${idx}`} style={[styles.listItem, idx > 0 && { borderTopWidth: 1, borderTopColor: isDark ? '#333' : '#EEE' }]}>
                                                <View style={styles.listTextCol}>
                                                    <Text style={[styles.itemName, darkModeWeightStyle.itemName, { color: themeColors.text }]}>
                                                        {cluster.stations[0].name} vs {cluster.stations[1].name}
                                                    </Text>
                                                    <Text style={[styles.itemSub, numericTextStyle, darkModeWeightStyle.itemSub, { color: themeColors.textOpacity }]}>
                                                        {cluster.totalUpdates} updates recently
                                                    </Text>
                                                </View>
                                                <View style={styles.valPill}>
                                                    <Text style={[styles.itemVal, numericTextStyle, darkModeWeightStyle.itemVal, { color: themeColors.text }]}>
                                                        Avg ±{cluster.averageJumpAmount.toFixed(2)}¢
                                                    </Text>
                                                </View>
                                            </View>
                                        ))}
                                    </GlassView>
                                )}

                                {/* Empty/No Data Fallback */}
                                {!loading && !trendData?.averagePricesByDay?.length && !trendData?.leaderboard?.length && (
                                    <View style={styles.emptyState}>
                                        <Text style={[styles.emptyText, darkModeWeightStyle.emptyText, { color: themeColors.textOpacity }]}>Not enough historical data collected yet to render trends. Check back soon.</Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    )}
                </ScrollView>

                <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />
                <View style={[styles.header, { paddingTop: insets.top }]}>
                    <FuelUpHeaderLogo isDark={isDark} />
                </View>
            </View>
            <ProgressiveBlurReveal
                shouldReveal={shouldRunReveal}
            />
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
        alignItems: 'baseline',
    },
    heroPrice: {
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
    heroAxis: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        marginTop: 4,
    },
    axisText: {
        fontSize: 13,
        fontWeight: '600',
    },
    contentPad: {
        padding: 16,
    },
    glassCard: {
        borderRadius: 24,
        padding: 24,
        overflow: 'hidden',
    },
    cardTitle: {
        fontSize: 19,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    cardHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    cardMeta: {
        fontSize: 13,
        fontWeight: '500',
    },
    cardSubTitle: {
        fontSize: 14,
        fontWeight: '500',
        letterSpacing: -0.3,
    },
    listItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
    },
    listTextCol: {
        flex: 1,
        paddingRight: 16,
    },
    itemName: {
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: -0.3,
        marginBottom: 4,
    },
    itemSub: {
        fontSize: 14,
        fontWeight: '500',
    },
    valPill: {
        justifyContent: 'center',
    },
    itemVal: {
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    shiftRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    shiftSymbol: {
        marginRight: 2,
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
