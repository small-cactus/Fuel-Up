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
    buildTrendRequestKey,
    captureTrendCacheGeneration,
    clearTrendDataCache,
    fetchTrendData,
    getCachedTrendData,
    getInFlightTrendDataRequest,
    getLastResolvedTrendData,
    getLastTrendsScreenViewedAt,
    isTrendCacheGenerationCurrent,
    setCachedTrendData,
    setLastResolvedTrendData,
    setLastTrendsScreenViewedAt,
} from '../../src/services/fuel/trends';
import { useAppState } from '../../src/AppStateContext';
import { usePreferences } from '../../src/PreferencesContext';
import TopCanopy from '../../src/components/TopCanopy';
import FuelUpHeaderLogo from '../../src/components/FuelUpHeaderLogo';
import { getFuelGradeMeta, normalizeFuelGrade } from '../../src/lib/fuelGrade';
import { buildResolvedFuelSearchContext } from '../../src/lib/fuelSearchState';

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

function ContainerlessAreaChart({ data, width, height, isDark, trendColor, topBleed = 40 }) {
    if (!data || data.length === 0) return null;

    const margin = { top: topBleed, right: 0, bottom: 0, left: 0 };
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
            })
            : ''
    ), [
        minimumRating,
        preferredProvider,
        searchRadiusMiles,
        selectedFuelGrade,
        sharedSearchOrigin,
    ]);
    const liveCachedTrendData = currentTrendRequestKey
        ? getCachedTrendData(currentTrendRequestKey)
        : null;
    const [loading, setLoading] = useState(!liveCachedTrendData);
    const [refreshing, setRefreshing] = useState(false);
    const [trendData, setTrendData] = useState(liveCachedTrendData);
    const [activeGradientColors, setActiveGradientColors] = useState(() => {
        const initialGradientData = liveCachedTrendData || getLastResolvedTrendData(currentTrendRequestKey) || null;
        return buildTrendBackgroundGradientColors({
            direction: getTrendDirectionFromData(initialGradientData),
            isDark,
        });
    });
    const [incomingGradientColors, setIncomingGradientColors] = useState(null);
    const isMountedRef = useRef(true);
    const isFocusedRef = useRef(false);
    const activeTrendRequestKeyRef = useRef(currentTrendRequestKey);
    const gradientFadeOpacity = useRef(new Animated.Value(1)).current;
    const activeFetchRef = useRef({
        requestKey: null,
        promise: null,
    });

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        activeTrendRequestKeyRef.current = currentTrendRequestKey;
    }, [currentTrendRequestKey]);

    useEffect(() => {
        if (!fuelResetToken) {
            return;
        }

        clearTrendDataCache();
        activeFetchRef.current = {
            requestKey: null,
            promise: null,
        };
        setTrendData(null);
        setLoading(false);
        setRefreshing(false);
        setIncomingGradientColors(null);
        gradientFadeOpacity.setValue(1);
        setActiveGradientColors(buildTrendBackgroundGradientColors({
            direction: null,
            isDark,
        }));
    }, [fuelResetToken, gradientFadeOpacity, isDark]);

    useEffect(() => {
        if (!currentTrendRequestKey) {
            setTrendData(null);
            setLoading(true);
            setIncomingGradientColors(null);
            gradientFadeOpacity.setValue(1);
            setActiveGradientColors(buildTrendBackgroundGradientColors({
                direction: null,
                isDark,
            }));
            return;
        }

        const nextCachedData = getCachedTrendData(currentTrendRequestKey);
        const nextGradientData = nextCachedData || getLastResolvedTrendData(currentTrendRequestKey) || null;
        setTrendData(nextCachedData || getLastResolvedTrendData(currentTrendRequestKey) || null);
        setLoading(!nextCachedData);
        setIncomingGradientColors(null);
        gradientFadeOpacity.setValue(1);
        setActiveGradientColors(buildTrendBackgroundGradientColors({
            direction: getTrendDirectionFromData(nextGradientData),
            isDark,
        }));
    }, [currentTrendRequestKey, gradientFadeOpacity, isDark]);

    useEffect(() => {
        if (!liveCachedTrendData || trendData === liveCachedTrendData) {
            return;
        }

        setTrendData(liveCachedTrendData);
        setLoading(false);
    }, [liveCachedTrendData, trendData]);

    const commitResolvedSearchOrigin = useCallback((origin, locationSource) => {
        const nextContext = buildResolvedFuelSearchContext({
            origin,
            locationSource,
            fuelGrade: selectedFuelGrade,
            radiusMiles: searchRadiusMiles,
            preferredProvider,
            minimumRating,
        });

        if (nextContext) {
            setResolvedFuelSearchContext(nextContext);
        }
    }, [
        minimumRating,
        preferredProvider,
        searchRadiusMiles,
        selectedFuelGrade,
        setResolvedFuelSearchContext,
    ]);

    const resolveTrendRequestContext = useCallback(async () => {
        if (resolvedManualOrigin) {
            commitResolvedSearchOrigin(resolvedManualOrigin, 'manual');
            return {
                latitude: resolvedManualOrigin.latitude,
                longitude: resolvedManualOrigin.longitude,
                locationSource: 'manual',
                requestKey: buildTrendRequestKey({
                    latitude: resolvedManualOrigin.latitude,
                    longitude: resolvedManualOrigin.longitude,
                    fuelType: selectedFuelGrade,
                    radiusMiles: searchRadiusMiles,
                    preferredProvider,
                    minimumRating,
                }),
            };
        }

        if (sharedSearchOrigin) {
            return {
                latitude: sharedSearchOrigin.latitude,
                longitude: sharedSearchOrigin.longitude,
                locationSource: sharedSearchOrigin.locationSource || 'device',
                requestKey: buildTrendRequestKey({
                    latitude: sharedSearchOrigin.latitude,
                    longitude: sharedSearchOrigin.longitude,
                    fuelType: selectedFuelGrade,
                    radiusMiles: searchRadiusMiles,
                    preferredProvider,
                    minimumRating,
                }),
            };
        }

        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
            permission = await Location.requestForegroundPermissionsAsync();
        }

        let nextOrigin = null;
        let locationSource = 'fallback';

        if (permission.status === 'granted') {
            const location = await Location.getCurrentPositionAsync({});
            nextOrigin = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };
            locationSource = 'device';
        }

        if (!nextOrigin) {
            nextOrigin = {
                latitude: 37.3346,
                longitude: -122.009,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };
        }

        commitResolvedSearchOrigin(nextOrigin, locationSource);

        return {
            latitude: nextOrigin.latitude,
            longitude: nextOrigin.longitude,
            locationSource,
            requestKey: buildTrendRequestKey({
                latitude: nextOrigin.latitude,
                longitude: nextOrigin.longitude,
                fuelType: selectedFuelGrade,
                radiusMiles: searchRadiusMiles,
                preferredProvider,
                minimumRating,
            }),
        };
    }, [
        commitResolvedSearchOrigin,
        minimumRating,
        preferredProvider,
        resolvedManualOrigin,
        searchRadiusMiles,
        selectedFuelGrade,
        sharedSearchOrigin,
    ]);

    const loadTrendData = useCallback(({
        showLoading = false,
    } = {}) => {
        if (
            currentTrendRequestKey &&
            activeFetchRef.current.promise &&
            activeFetchRef.current.requestKey === currentTrendRequestKey
        ) {
            return activeFetchRef.current.promise;
        }

        if (showLoading && isMountedRef.current) {
            setTrendData(null);
            setLoading(true);
        }

        const request = (async () => {
            let requestContext = null;
            try {
                const requestGeneration = captureTrendCacheGeneration();
                requestContext = await resolveTrendRequestContext();
                const {
                    latitude,
                    longitude,
                    requestKey,
                } = requestContext;

                activeTrendRequestKeyRef.current = requestKey;
                activeFetchRef.current = {
                    requestKey,
                    promise: request,
                };

                const sharedPrefetchRequest = getInFlightTrendDataRequest(requestKey);
                if (sharedPrefetchRequest) {
                    const prefetchedData = await sharedPrefetchRequest;

                    if (
                        isMountedRef.current &&
                        activeTrendRequestKeyRef.current === requestKey
                    ) {
                        setTrendData(prefetchedData || null);
                        setLoading(false);
                    }

                    return prefetchedData || null;
                }

                const data = await fetchTrendData({
                    latitude,
                    longitude,
                    fuelType: selectedFuelGrade,
                    radiusMiles: searchRadiusMiles,
                    minimumRating,
                });

                if (!isTrendCacheGenerationCurrent(requestGeneration)) {
                    return;
                }

                setCachedTrendData(requestKey, data);
                setLastResolvedTrendData(requestKey, data);

                if (isMountedRef.current) {
                    if (activeTrendRequestKeyRef.current === requestKey) {
                        setTrendData(data);
                    }
                }
            } catch (err) {
                console.warn('Error loading trends data', err);
            } finally {
                if (isMountedRef.current) {
                    if (
                        !requestContext ||
                        activeTrendRequestKeyRef.current === requestContext.requestKey
                    ) {
                        setLoading(false);
                    }
                }
                if (activeFetchRef.current.promise === request) {
                    activeFetchRef.current = {
                        requestKey: null,
                        promise: null,
                    };
                }
            }
        })();

        activeFetchRef.current = {
            requestKey: currentTrendRequestKey || null,
            promise: request,
        };
        return request;
    }, [
        currentTrendRequestKey,
        minimumRating,
        resolveTrendRequestContext,
        searchRadiusMiles,
        selectedFuelGrade,
    ]);

    useFocusEffect(
        useCallback(() => {
            isFocusedRef.current = true;
            const now = Date.now();
            const cachedDataForRequest = currentTrendRequestKey
                ? getCachedTrendData(currentTrendRequestKey)
                : null;
            const lastViewedAtForRequest = currentTrendRequestKey
                ? getLastTrendsScreenViewedAt(currentTrendRequestKey)
                : 0;
            const hasExpired = currentTrendRequestKey
                ? (now - lastViewedAtForRequest) > VIEW_REFRESH_INTERVAL_MS
                : true;
            const shouldFetch = !cachedDataForRequest || hasExpired || !currentTrendRequestKey;

            if (currentTrendRequestKey) {
                setLastTrendsScreenViewedAt(currentTrendRequestKey, now);
            }

            if (cachedDataForRequest && trendData !== cachedDataForRequest) {
                setTrendData(cachedDataForRequest);
                setLoading(false);
            } else if (!cachedDataForRequest) {
                setTrendData(null);
            }

            if (shouldFetch) {
                const shouldAnimateFetchedEntry = !cachedDataForRequest;
                void loadTrendData({
                    showLoading: shouldAnimateFetchedEntry,
                });
            }
            return () => {
                isFocusedRef.current = false;
            };
        }, [currentTrendRequestKey, loadTrendData, trendData])
    );

    const onPullToRefresh = useCallback(() => {
        setRefreshing(true);
        if (currentTrendRequestKey) {
            setLastTrendsScreenViewedAt(currentTrendRequestKey, Date.now());
        }

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
    }, [currentTrendRequestKey, loadTrendData]);

    const resolvedTrendData = trendData || liveCachedTrendData || null;
    const fallbackResolvedTrendData = currentTrendRequestKey
        ? getLastResolvedTrendData(currentTrendRequestKey)
        : null;
    const realDisplayTrendData = resolvedTrendData || fallbackResolvedTrendData || null;
    const displayTrendData = realDisplayTrendData;
    const heroTrendData = displayTrendData;
    const hasHeroTrendData = Boolean(heroTrendData?.averagePricesByDay?.length > 1);
    const gradientSourceData = displayTrendData || null;
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
    const heroDeltaLabel = useMemo(() => {
        if (!heroTrendData?.overallTrend || heroTrendData.averagePricesByDay.length < 2) {
            return null;
        }

        return formatTrendDeltaPercent(
            heroTrendData.overallTrend.delta,
            heroTrendData.averagePricesByDay[0]?.price
        );
    }, [heroTrendData]);
    const shouldShowAwaitingLocalHistoryText = hasHeroTrendData && (
        heroTrendDirection === 'flat' ||
        heroTrendDirection == null ||
        !heroTrendData?.overallTrend
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
                            {hasHeroTrendData ? (
                                <View style={styles.heroGraphSection}>
                                    <View style={styles.heroGraphPad}>
                                        <Text style={[styles.heroSub, darkModeWeightStyle.heroSub, { color: themeColors.textOpacity }]}>
                                            Your {selectedFuelGradeMeta.label} Local Average
                                        </Text>
                                        <View style={styles.heroPriceRow}>
                                            <Text style={[styles.heroPrice, numericTextStyle, darkModeWeightStyle.heroPrice, { color: themeColors.text }]}>
                                                ${heroTrendData.averagePricesByDay[heroTrendData.averagePricesByDay.length - 1].price.toFixed(2)}
                                            </Text>
                                            {heroDeltaLabel ? (
                                                <Text style={[styles.heroDelta, numericTextStyle, darkModeWeightStyle.heroDelta, { color: primaryTrendColor }]}>
                                                    {heroDeltaLabel}
                                                </Text>
                                            ) : null}
                                        </View>
                                    </View>
                                    {shouldShowAwaitingLocalHistoryText ? (
                                        <View style={styles.heroStatusWrap}>
                                            <Text style={[styles.heroPreviewText, darkModeWeightStyle.itemSub, { color: themeColors.text }]}>
                                                We&apos;re still collecting enough local history to replace this preview with live trend data.
                                            </Text>
                                        </View>
                                    ) : null}

                                    <ContainerlessAreaChart
                                        data={heroTrendData.averagePricesByDay}
                                        width={SCREEN_WIDTH}
                                        height={CHART_HEIGHT}
                                        isDark={isDark}
                                        trendColor={primaryTrendColor}
                                        topBleed={shouldShowAwaitingLocalHistoryText ? 0 : 40}
                                    />

                                    <View style={styles.heroAxis}>
                                        <Text style={[styles.axisText, numericTextStyle, darkModeWeightStyle.axisText, { color: themeColors.textOpacity }]}>
                                            {formatTrendAxisLabel(
                                                heroTrendData.averagePricesByDay[0].date,
                                                heroTrendData.averagePricesByDay[0].date,
                                                heroTrendData.averagePricesByDay[heroTrendData.averagePricesByDay.length - 1].date
                                            )}
                                        </Text>
                                        <Text style={[styles.axisText, numericTextStyle, darkModeWeightStyle.axisText, { color: themeColors.textOpacity }]}>
                                            {formatTrendAxisLabel(
                                                heroTrendData.averagePricesByDay[heroTrendData.averagePricesByDay.length - 1].date,
                                                heroTrendData.averagePricesByDay[0].date,
                                                heroTrendData.averagePricesByDay[heroTrendData.averagePricesByDay.length - 1].date
                                            )}
                                        </Text>
                                    </View>
                                </View>
                            ) : loading ? (
                                <View style={styles.heroGraphPlaceholderSection}>
                                    <View style={styles.heroGraphPad}>
                                        <Text style={[styles.heroSub, darkModeWeightStyle.heroSub, { color: themeColors.textOpacity }]}>
                                            Your {selectedFuelGradeMeta.label} Local Average
                                        </Text>
                                        <View style={styles.heroPriceRow}>
                                            <View style={[styles.heroPricePlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                                            <View style={[styles.heroDeltaPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]} />
                                        </View>
                                    </View>
                                    <View style={styles.heroChartPlaceholderWrap}>
                                        <View style={[styles.heroChartPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]} />
                                    </View>
                                    <View style={styles.heroAxis}>
                                        <View style={[styles.axisPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} />
                                        <View style={[styles.axisPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} />
                                    </View>
                                </View>
                            ) : null}

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
    heroPreviewText: {
        fontSize: 13,
        lineHeight: 18,
        letterSpacing: -0.2,
    },
    heroStatusWrap: {
        minHeight: 40,
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 12,
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
