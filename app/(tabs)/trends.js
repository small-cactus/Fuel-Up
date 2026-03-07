import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Animated, StyleSheet, Text, View, ScrollView, Dimensions, RefreshControl } from 'react-native';
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
import {
    fetchTrendData,
    getCachedTrendData,
    getLastResolvedTrendData,
    getLastTrendsScreenViewedAt,
    setCachedTrendData,
    setLastResolvedTrendData,
    setLastTrendsScreenViewedAt,
} from '../../src/services/fuel/trends';
import { usePreferences } from '../../src/PreferencesContext';
import TopCanopy from '../../src/components/TopCanopy';
import FuelUpHeaderLogo from '../../src/components/FuelUpHeaderLogo';
import { getFuelGradeMeta, normalizeFuelGrade } from '../../src/lib/fuelGrade';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 220;
const TOP_CANOPY_HEIGHT = 44;
const VIEW_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
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

function buildMockTrendData() {
    const now = new Date();
    const buildDay = (daysAgo, price) => {
        const date = new Date(now);
        date.setDate(now.getDate() - daysAgo);
        return {
            date: date.toISOString(),
            price,
        };
    };

    return {
        averagePricesByDay: [
            buildDay(6, 3.79),
            buildDay(5, 3.76),
            buildDay(4, 3.74),
            buildDay(3, 3.71),
            buildDay(2, 3.69),
            buildDay(1, 3.67),
            buildDay(0, 3.64),
        ],
        overallTrend: {
            isDecrease: true,
            delta: -0.15,
        },
        leaderboardLastChangedAt: new Date(now.getTime() - (12 * 60 * 1000)).toISOString(),
        leaderboard: [
            {
                stationId: 'mock-1',
                name: 'Shell',
                address: '1200 Main St, Cupertino, CA',
                distanceMiles: 0.8,
                latestPrice: 3.59,
                rankShift: 1,
            },
            {
                stationId: 'mock-2',
                name: 'Chevron',
                address: '1980 Stevens Creek Blvd, Cupertino, CA',
                distanceMiles: 1.1,
                latestPrice: 3.62,
                rankShift: 0,
            },
            {
                stationId: 'mock-3',
                name: '76',
                address: '10455 N De Anza Blvd, Cupertino, CA',
                distanceMiles: 1.5,
                latestPrice: 3.64,
                rankShift: -1,
            },
        ],
        competitorClusters: [
            {
                stations: [
                    { name: 'Shell' },
                    { name: 'Chevron' },
                ],
                totalUpdates: 18,
                averageJumpAmount: 0.06,
            },
            {
                stations: [
                    { name: 'Arco' },
                    { name: '76' },
                ],
                totalUpdates: 11,
                averageJumpAmount: 0.04,
            },
        ],
    };
}

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

function getTrendDirectionFromData(data) {
    const pricesByDay = data?.averagePricesByDay;
    if (!pricesByDay || pricesByDay.length < 2) {
        return null;
    }

    const todayPrice = pricesByDay[pricesByDay.length - 1].price;
    const yesterdayPrice = pricesByDay[pricesByDay.length - 2].price;

    if (todayPrice < yesterdayPrice) {
        return 'lower';
    }

    if (todayPrice > yesterdayPrice) {
        return 'higher';
    }

    return 'flat';
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
    const liveCachedTrendData = getCachedTrendData(selectedFuelGrade);
    const [loading, setLoading] = useState(!liveCachedTrendData);
    const [refreshing, setRefreshing] = useState(false);
    const [trendData, setTrendData] = useState(liveCachedTrendData);
    const [activeGradientColors, setActiveGradientColors] = useState(() => {
        const initialGradientData = liveCachedTrendData || getLastResolvedTrendData(selectedFuelGrade) || null;
        return buildTrendBackgroundGradientColors({
            direction: getTrendDirectionFromData(initialGradientData),
            isDark: false,
        });
    });
    const [incomingGradientColors, setIncomingGradientColors] = useState(null);
    const isMountedRef = useRef(true);
    const isFocusedRef = useRef(false);
    const selectedFuelGradeRef = useRef(selectedFuelGrade);
    const gradientFadeOpacity = useRef(new Animated.Value(1)).current;
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
        const nextCachedData = getCachedTrendData(selectedFuelGrade);
        const nextGradientData = nextCachedData || getLastResolvedTrendData(selectedFuelGrade) || null;
        setTrendData(nextCachedData);
        setLoading(!nextCachedData);
        setIncomingGradientColors(null);
        gradientFadeOpacity.setValue(1);
        setActiveGradientColors(buildTrendBackgroundGradientColors({
            direction: getTrendDirectionFromData(nextGradientData),
            isDark,
        }));
    }, [gradientFadeOpacity, isDark, selectedFuelGrade]);

    useEffect(() => {
        if (!liveCachedTrendData || trendData === liveCachedTrendData) {
            return;
        }

        setTrendData(liveCachedTrendData);
        setLoading(false);
    }, [liveCachedTrendData, trendData]);

    const loadTrendData = useCallback(({
        showLoading = false,
    } = {}) => {
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

                setCachedTrendData(requestFuelGrade, data);
                setLastResolvedTrendData(requestFuelGrade, data);

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
            isFocusedRef.current = true;
            const now = Date.now();
            const cachedDataForFuelType = getCachedTrendData(selectedFuelGrade);
            const lastViewedAtForFuelType = getLastTrendsScreenViewedAt(selectedFuelGrade);
            const hasExpired = (now - lastViewedAtForFuelType) > VIEW_REFRESH_INTERVAL_MS;
            const shouldFetch = !cachedDataForFuelType || hasExpired;

            setLastTrendsScreenViewedAt(selectedFuelGrade, now);

            if (cachedDataForFuelType && trendData !== cachedDataForFuelType) {
                setTrendData(cachedDataForFuelType);
            }

            if (shouldFetch) {
                const shouldAnimateFetchedEntry = !cachedDataForFuelType;
                void loadTrendData({
                    showLoading: shouldAnimateFetchedEntry,
                });
            }
            return () => {
                isFocusedRef.current = false;
            };
        }, [loadTrendData, selectedFuelGrade, trendData])
    );

    const onPullToRefresh = useCallback(() => {
        setRefreshing(true);
        setLastTrendsScreenViewedAt(selectedFuelGrade, Date.now());

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

    const mockTrendData = useMemo(() => buildMockTrendData(), []);
    const resolvedTrendData = trendData || liveCachedTrendData || null;
    const displayTrendData = resolvedTrendData || (loading ? mockTrendData : null);
    const gradientSourceData = resolvedTrendData || getLastResolvedTrendData(selectedFuelGrade) || null;
    const isPriceDrop = displayTrendData?.overallTrend?.isDecrease;
    // Better = Green, Worse = Red
    const primaryTrendColor = isPriceDrop ? COLORS.GREEN : COLORS.RED;
    const secondaryTrendColor = isPriceDrop ? COLORS.GREEN_DARK : COLORS.RED_DARK;

    const todayTrendDirection = useMemo(
        () => getTrendDirectionFromData(displayTrendData),
        [displayTrendData]
    );
    const targetGradientColors = useMemo(() => (
        buildTrendBackgroundGradientColors({
            direction: getTrendDirectionFromData(gradientSourceData),
            isDark,
        })
    ), [gradientSourceData, isDark]);

    useEffect(() => {
        if (areGradientColorSetsEqual(activeGradientColors, targetGradientColors)) {
            if (incomingGradientColors) {
                setIncomingGradientColors(null);
            }
            gradientFadeOpacity.setValue(1);
            return;
        }

        setIncomingGradientColors(targetGradientColors);
        gradientFadeOpacity.setValue(0);

        Animated.timing(gradientFadeOpacity, {
            toValue: 1,
            duration: 650,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (!finished) {
                return;
            }

            setActiveGradientColors(targetGradientColors);
            setIncomingGradientColors(null);
            gradientFadeOpacity.setValue(1);
        });
    }, [
        activeGradientColors,
        gradientFadeOpacity,
        incomingGradientColors,
        targetGradientColors,
    ]);

    const glassTintColor = isDark ? '#101010ff' : '#FFFFFF';
    const canopyEdgeLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const gradientSpread = clamp01(TREND_BACKGROUND_GRADIENT_SPREAD);
    const numericTextStyle = styles.numericRounded;
    const leaderboardUpdatedLabel = useMemo(
        () => formatRelativeTime(displayTrendData?.leaderboardLastChangedAt),
        [displayTrendData?.leaderboardLastChangedAt]
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
                            refreshing={refreshing}
                            onRefresh={onPullToRefresh}
                            tintColor={themeColors.text}
                            colors={[themeColors.text]}
                            progressBackgroundColor={isDark ? '#111111' : '#FFFFFF'}
                            progressViewOffset={topCanopyHeight + 8}
                        />
                    )}
                >
                    <View style={styles.contentWrap}>
                            {/* 1. Containerless Area Chart (Bleeding Edges) */}
                            {displayTrendData?.averagePricesByDay?.length > 1 && (
                                <View style={styles.heroGraphSection}>
                                    <View style={styles.heroGraphPad}>
                                        <Text style={[styles.heroSub, darkModeWeightStyle.heroSub, { color: themeColors.textOpacity }]}>
                                            Your {selectedFuelGradeMeta.label} Local Average
                                        </Text>
                                        <View style={styles.heroPriceRow}>
                                            <Text style={[styles.heroPrice, numericTextStyle, darkModeWeightStyle.heroPrice, { color: themeColors.text }]}>
                                                ${displayTrendData.averagePricesByDay[displayTrendData.averagePricesByDay.length - 1].price.toFixed(2)}
                                            </Text>
                                            <Text style={[styles.heroDelta, numericTextStyle, darkModeWeightStyle.heroDelta, { color: primaryTrendColor }]}>
                                                {displayTrendData.overallTrend.delta > 0 ? '+' : ''}{displayTrendData.overallTrend.delta.toFixed(2)}¢
                                            </Text>
                                        </View>
                                    </View>

                                    <ContainerlessAreaChart
                                        data={displayTrendData.averagePricesByDay}
                                        width={SCREEN_WIDTH}
                                        height={CHART_HEIGHT}
                                        isDark={isDark}
                                        trendColor={primaryTrendColor}
                                    />

                                    <View style={styles.heroAxis}>
                                        <Text style={[styles.axisText, numericTextStyle, darkModeWeightStyle.axisText, { color: themeColors.textOpacity }]}>
                                            {new Date(displayTrendData.averagePricesByDay[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                        </Text>
                                        <Text style={[styles.axisText, numericTextStyle, darkModeWeightStyle.axisText, { color: themeColors.textOpacity }]}>
                                            {new Date(displayTrendData.averagePricesByDay[displayTrendData.averagePricesByDay.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                        </Text>
                                    </View>
                                </View>
                            )}

                            <View style={styles.contentPad}>
                                {/* 2. Leaderboard */}
                                {displayTrendData?.leaderboard?.length > 0 && (
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
                                        {displayTrendData.leaderboard.map((st, idx) => {
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
                                {displayTrendData?.competitorClusters?.length > 0 && (
                                    <GlassView
                                        style={[styles.glassCard, { marginTop: 16 }]}
                                        glassEffectStyle="regular"
                                        tintColor={glassTintColor}
                                    >
                                        <Text style={[styles.cardTitle, darkModeWeightStyle.cardTitle, { color: themeColors.text, marginBottom: 4 }]}>Fierce Competitors</Text>
                                        <Text style={[styles.cardSubTitle, darkModeWeightStyle.cardSubTitle, { color: themeColors.textOpacity, marginBottom: 16 }]}>Stations battling on the same block</Text>

                                        {displayTrendData.competitorClusters.map((cluster, idx) => (
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
                                {!loading && !displayTrendData?.averagePricesByDay?.length && !displayTrendData?.leaderboard?.length && (
                                    <View style={styles.emptyState}>
                                        <Text style={[styles.emptyText, darkModeWeightStyle.emptyText, { color: themeColors.textOpacity }]}>Not enough historical data collected yet to render trends. Check back soon.</Text>
                                    </View>
                                )}
                            </View>
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
