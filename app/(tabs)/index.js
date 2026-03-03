import React, { startTransition, useEffect, useRef, useState, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import {
    LiquidGlassView,
    LiquidGlassContainerView,
    isLiquidGlassSupported
} from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';
import { GlassView } from 'expo-glass-effect';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_APPLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../../src/AppStateContext';
import FuelSummaryCard from '../../src/components/FuelSummaryCard';
import ClusterDebugCard from '../../src/components/ClusterDebugCard';
import TopCanopy from '../../src/components/TopCanopy';
import { getCachedFuelPriceSnapshot, getFuelFailureMessage, refreshFuelPriceSnapshot } from '../../src/services/fuel';
import { useTheme } from '../../src/ThemeContext';
import { usePreferences } from '../../src/PreferencesContext';
import BottomCanopy from '../../src/components/BottomCanopy';
import Animated, {
    useSharedValue,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useAnimatedProps,
    interpolate,
    Extrapolate,
    interpolateColor,
    FadeIn,
    FadeOut,
    ZoomIn,
    ZoomOut,
    withTiming
} from 'react-native-reanimated';

const AnimatedLiquidGlassView = Animated.createAnimatedComponent(LiquidGlassView);
const AnimatedLiquidGlassContainer = Animated.createAnimatedComponent(LiquidGlassContainerView);
const {
    CLUSTER_MERGE_LAT_FACTOR,
    CLUSTER_MERGE_LNG_FACTOR,
    CLUSTER_SPLIT_MULTIPLIER,
    CLUSTER_SPREAD_DEADZONE,
    COLLAPSED_PRIMARY_WIDTH,
    COLLAPSED_SECONDARY_WIDTH,
    COLLAPSED_BUBBLE_OFFSET,
    computeClusterHandoffDiagnostic,
    computeMorphProgress,
    computeSpreadProgressFromCluster,
} = require('../../src/lib/clusterAnimationMath.cjs');

const DEFAULT_REGION = {
    latitude: 37.3346,
    longitude: -122.009,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
};
const TAB_BAR_CLEARANCE = 34;
const CARD_GAP = 0;
const SIDE_MARGIN = 16;
const TOP_CANOPY_HEIGHT = 72;
const CLUSTER_DEBUG_JUMP_THRESHOLD = 5;
const MAP_REGION_EPSILON = 0.000001;
const CHIP_ANIMATION_DURATION = 420;
const CHIP_BRIDGE_CLEAR_DELAY = 480;

function areRegionsEquivalent(currentRegion, nextRegion) {
    if (!currentRegion || !nextRegion) {
        return false;
    }

    return (
        Math.abs((currentRegion.latitude || 0) - (nextRegion.latitude || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.longitude || 0) - (nextRegion.longitude || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.latitudeDelta || 0) - (nextRegion.latitudeDelta || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.longitudeDelta || 0) - (nextRegion.longitudeDelta || 0)) <= MAP_REGION_EPSILON
    );
}

function formatDebugMetric(value, digits = 2) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }

    return value.toFixed(digits);
}

function summarizeDebugSeries(samples, key) {
    const values = samples
        .map(sample => sample[key])
        .filter(value => typeof value === 'number' && Number.isFinite(value));

    if (values.length === 0) {
        return null;
    }

    const start = values[0];
    const end = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
        start,
        end,
        min,
        max,
        delta: end - start,
    };
}

function formatSeriesLine(label, series, unit = '', digits = 2) {
    if (!series) {
        return `${label}=--`;
    }

    const deltaPrefix = series.delta > 0 ? '+' : '';

    return (
        `${label} ${formatDebugMetric(series.start, digits)} -> ${formatDebugMetric(series.end, digits)} ` +
        `(d ${deltaPrefix}${formatDebugMetric(series.delta, digits)}, min ${formatDebugMetric(series.min, digits)}, max ${formatDebugMetric(series.max, digits)})${unit}`
    );
}

function buildClusterDebugJumpEvents(samples) {
    const trackedMetrics = [
        ['primarySwitchDistance', 'switch(primary)'],
        ['secondarySwitchDistance', 'switch(secondary)'],
        ['nextPrimarySettleDistance', 'settle(primary)'],
        ['nextSecondarySettleDistance', 'settle(secondary)'],
        ['centerShiftDistance', 'centerShift'],
        ['shellWidthDelta', 'shellWidth'],
        ['plannedPrimaryMoveMagnitude', 'move(primary)'],
        ['plannedSecondaryMoveMagnitude', 'move(secondary)'],
    ];
    const events = [];

    for (let index = 1; index < samples.length; index += 1) {
        const previousSample = samples[index - 1];
        const nextSample = samples[index];

        for (const [metricKey, label] of trackedMetrics) {
            const previousValue = previousSample[metricKey];
            const nextValue = nextSample[metricKey];

            if (!Number.isFinite(previousValue) || !Number.isFinite(nextValue)) {
                continue;
            }

            const delta = nextValue - previousValue;
            if (Math.abs(delta) <= CLUSTER_DEBUG_JUMP_THRESHOLD) {
                continue;
            }

            const causes = [];
            const rules = [];

            if (previousSample.clusterKey !== nextSample.clusterKey) {
                causes.push(`watched cluster changed (${previousSample.clusterKey} -> ${nextSample.clusterKey})`);
            }
            if (previousSample.summary !== nextSample.summary) {
                causes.push(`summary changed ("${previousSample.summary}" -> "${nextSample.summary}")`);
            }
            if (
                Math.abs(nextSample.nextMountSpread - nextSample.nextResolvedSpread) > 0.001 ||
                Math.abs(previousSample.nextMountSpread - previousSample.nextResolvedSpread) > 0.001
            ) {
                causes.push(
                    `incoming first-frame spread mismatch (${formatDebugMetric(previousSample.nextMountSpread)} -> ${formatDebugMetric(previousSample.nextResolvedSpread)} then ${formatDebugMetric(nextSample.nextMountSpread)} -> ${formatDebugMetric(nextSample.nextResolvedSpread)})`
                );
                rules.push('Carryover rule: a continuing multi-quote overlay keeps the previous spread/morph on the first frame, then animates to the new resolved values.');
            }
            if (Math.abs(delta) === Math.abs(nextSample.centerShiftDistance - previousSample.centerShiftDistance) || metricKey === 'centerShiftDistance') {
                rules.push('Anchor rule: if the watched cluster changes to a different primary station, the marker anchor itself moves.');
            }
            if (metricKey === 'shellWidthDelta' || Math.abs(nextSample.shellWidthDelta - previousSample.shellWidthDelta) > CLUSTER_DEBUG_JUMP_THRESHOLD) {
                rules.push('Shell width rule: secondary shell width interpolates from 44pt to the same 84pt width used by standalone price shells.');
            }
            if (metricKey !== 'shellWidthDelta') {
                rules.push(`Spread rule: spread stays at 0 until overlap ratio clears the ${CLUSTER_SPREAD_DEADZONE.toFixed(2)} deadzone, using split thresholds = merge thresholds * 1.5.`);
            }

            const deltaPrefix = delta > 0 ? '+' : '';
            events.push(
                [
                    `- ${label} jumped ${deltaPrefix}${formatDebugMetric(delta)}pt (${formatDebugMetric(previousValue)} -> ${formatDebugMetric(nextValue)})`,
                    `  causes: ${causes.length > 0 ? causes.join('; ') : 'same watched cluster, metric moved due to threshold interpolation and map motion'}`,
                    `  rules: ${Array.from(new Set(rules)).join(' | ')}`,
                    `  factors: mapDelta ${formatDebugMetric(previousSample.mapLatitudeDelta, 4)}/${formatDebugMetric(previousSample.mapLongitudeDelta, 4)} -> ${formatDebugMetric(nextSample.mapLatitudeDelta, 4)}/${formatDebugMetric(nextSample.mapLongitudeDelta, 4)}, split ${formatDebugMetric(previousSample.splitLatThreshold, 4)}/${formatDebugMetric(previousSample.splitLngThreshold, 4)} -> ${formatDebugMetric(nextSample.splitLatThreshold, 4)}/${formatDebugMetric(nextSample.splitLngThreshold, 4)}, spread ${formatDebugMetric(previousSample.currentResolvedSpread)} -> ${formatDebugMetric(nextSample.currentResolvedSpread)}, next spread ${formatDebugMetric(previousSample.nextResolvedSpread)} -> ${formatDebugMetric(nextSample.nextResolvedSpread)}, morph ${formatDebugMetric(previousSample.currentResolvedMorph)} -> ${formatDebugMetric(nextSample.currentResolvedMorph)}, next morph ${formatDebugMetric(previousSample.nextResolvedMorph)} -> ${formatDebugMetric(nextSample.nextResolvedMorph)}, center shift ${formatDebugMetric(previousSample.centerShiftDistance)} -> ${formatDebugMetric(nextSample.centerShiftDistance)}, width ${formatDebugMetric(previousSample.shellWidthDelta)} -> ${formatDebugMetric(nextSample.shellWidthDelta)}, cluster size ${previousSample.clusterSize} -> ${nextSample.clusterSize}`
                ].join('\n')
            );
        }
    }

    return events;
}

function buildClusterDebugRecordingLog(samples) {
    if (!samples || samples.length === 0) {
        return '[ClusterDebug Recording]\nNo samples captured.';
    }

    const startedAt = samples[0].timestamp;
    const endedAt = samples[samples.length - 1].timestamp;
    const durationMs = Math.max(0, endedAt - startedAt);
    const clusterTransitions = samples.reduce((count, sample, index) => {
        if (index === 0) {
            return 0;
        }

        return count + (sample.clusterKey !== samples[index - 1].clusterKey ? 1 : 0);
    }, 0);
    const primarySwitchSeries = summarizeDebugSeries(samples, 'primarySwitchDistance');
    const secondarySwitchSeries = summarizeDebugSeries(samples, 'secondarySwitchDistance');
    const primarySettleSeries = summarizeDebugSeries(samples, 'nextPrimarySettleDistance');
    const secondarySettleSeries = summarizeDebugSeries(samples, 'nextSecondarySettleDistance');
    const centerShiftSeries = summarizeDebugSeries(samples, 'centerShiftDistance');
    const spreadSeries = summarizeDebugSeries(samples, 'currentResolvedSpread');
    const nextSpreadSeries = summarizeDebugSeries(samples, 'nextResolvedSpread');
    const shellWidthSeries = summarizeDebugSeries(samples, 'shellWidthDelta');
    const primaryMoveMagnitudeSeries = summarizeDebugSeries(samples, 'plannedPrimaryMoveMagnitude');
    const secondaryMoveMagnitudeSeries = summarizeDebugSeries(samples, 'plannedSecondaryMoveMagnitude');
    const jumpEvents = buildClusterDebugJumpEvents(samples);

    return [
        '[ClusterDebug Recording]',
        `samples=${samples.length} duration=${durationMs}ms clusterChanges=${clusterTransitions}`,
        `watchedStart=${samples[0].clusterKey}`,
        `watchedEnd=${samples[samples.length - 1].clusterKey}`,
        formatSeriesLine('spread(cur)', spreadSeries),
        formatSeriesLine('spread(next)', nextSpreadSeries),
        formatSeriesLine('switch(primary)', primarySwitchSeries, 'pt'),
        formatSeriesLine('switch(secondary)', secondarySwitchSeries, 'pt'),
        formatSeriesLine('settle(primary)', primarySettleSeries, 'pt'),
        formatSeriesLine('settle(secondary)', secondarySettleSeries, 'pt'),
        formatSeriesLine('centerShift', centerShiftSeries, 'pt'),
        formatSeriesLine('shellWidth', shellWidthSeries, 'pt'),
        formatSeriesLine('move(primary)', primaryMoveMagnitudeSeries, 'pt'),
        formatSeriesLine('move(secondary)', secondaryMoveMagnitudeSeries, 'pt'),
        `summaryStart=${samples[0].summary}`,
        `summaryEnd=${samples[samples.length - 1].summary}`,
        `largeStepChanges>${CLUSTER_DEBUG_JUMP_THRESHOLD}pt=${jumpEvents.length}`,
        ...(jumpEvents.length > 0
            ? ['Large step changes:', ...jumpEvents]
            : ['Large step changes: none']),
    ].join('\n');
}

function AnimatedMarkerOverlay({ cluster, scrollX, itemWidth, isDark, themeColors, activeIndex, onMarkerPress, mapRegion, isMapMoving }) {
    const { quotes, averageLat, averageLng } = cluster;

    // A cluster is considered active if any of its station indices matches the activeIndex
    const isActive = quotes.some(q => q.originalIndex === activeIndex);
    const isCheapestAcrossAll = quotes.some(q => q.originalIndex === 0);

    const animatedOverlayStyle = useAnimatedStyle(() => {
        return {};
    });

    const animatedTextStyle = useAnimatedStyle(() => {
        if (isCheapestAcrossAll) return { color: '#007AFF' };
        const baseIndex = quotes[0].originalIndex;
        const inputRange = [(baseIndex - 1) * itemWidth, baseIndex * itemWidth, (baseIndex + 1) * itemWidth];
        const color = interpolateColor(
            scrollX.value,
            inputRange,
            ['#888888', themeColors.text, '#888888']
        );
        return { color };
    });

    // Determine what to render inside the chip
    const primaryQuote = quotes[0];
    const isMultiQuote = quotes.length > 1;

    const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
    const resolvedSpread = isMultiQuote
        ? computeSpreadProgressFromCluster({
            quotes,
            averageLat,
            averageLng,
            mapRegion,
        })
        : 0;
    const resolvedMorph = computeMorphProgress(resolvedSpread);

    // Content fade-in animation
    const mountAnim = useSharedValue(0);
    // Animate relative bubble positions for "merging" effect
    const spreadAnim = useSharedValue(resolvedSpread);
    // Animate visual properties (Price vs +N styling) independently
    const morphAnim = useSharedValue(resolvedMorph);
    const splitBridgeProgress = useSharedValue(1);
    const splitBridgeMorph = useSharedValue(1);
    const [splitBridge, setSplitBridge] = useState(null);
    const previousQuotesRef = useRef(quotes);
    const splitBridgeTimeoutRef = useRef(null);
    const splitSettleTimeoutRef = useRef(null);
    const splitBridgeReadyToClearRef = useRef(false);

    const ptPerLng = mapRegion?.longitudeDelta ? SCREEN_WIDTH / mapRegion.longitudeDelta : 0;
    const ptPerLat = mapRegion?.latitudeDelta ? SCREEN_HEIGHT / mapRegion.latitudeDelta : 0;
    const primaryLat = primaryQuote.latitude;
    const primaryLng = primaryQuote.longitude;
    const anchoredQuotes = quotes.map(quote => {
        const dx = (quote.longitude - primaryLng) * ptPerLng;
        const dy = -(quote.latitude - primaryLat) * ptPerLat;
        return {
            ...quote,
            dx,
            dy,
            distanceFromPrimary: Math.hypot(dx, dy),
        };
    });
    const secondaryAnchoredQuotes = anchoredQuotes.slice(1);
    const emergingAnchoredQuote = secondaryAnchoredQuotes.length > 0
        ? secondaryAnchoredQuotes.reduce((farthestQuote, quote) => (
            quote.distanceFromPrimary > farthestQuote.distanceFromPrimary ? quote : farthestQuote
        ), secondaryAnchoredQuotes[0])
        : null;
    const remainingQuotes = emergingAnchoredQuote
        ? quotes.slice(1).filter(quote => quote.stationId !== emergingAnchoredQuote.stationId)
        : [];
    const hasRemainderBubble = remainingQuotes.length > 0;

    const nextClusterQuotes = emergingAnchoredQuote
        ? [primaryQuote, ...remainingQuotes]
        : [primaryQuote];
    const nextClusterAnchoredQuotes = nextClusterQuotes.map(quote => {
        const dx = (quote.longitude - primaryLng) * ptPerLng;
        const dy = -(quote.latitude - primaryLat) * ptPerLat;
        return {
            ...quote,
            dx,
            dy,
            distanceFromPrimary: Math.hypot(dx, dy),
        };
    });
    const nextClusterEmergingQuote = nextClusterAnchoredQuotes.length > 1
        ? nextClusterAnchoredQuotes.slice(1).reduce((farthestQuote, quote) => (
            quote.distanceFromPrimary > farthestQuote.distanceFromPrimary ? quote : farthestQuote
        ), nextClusterAnchoredQuotes[1])
        : null;
    const horizontalReach = Math.max(
        COLLAPSED_BUBBLE_OFFSET,
        ...anchoredQuotes.map(quote => Math.abs(quote.dx)),
        ...nextClusterAnchoredQuotes.map(quote => Math.abs(quote.dx))
    );
    const verticalReach = Math.max(
        0,
        ...anchoredQuotes.map(quote => Math.abs(quote.dy)),
        ...nextClusterAnchoredQuotes.map(quote => Math.abs(quote.dy))
    );
    const containerWidth = Math.max(240, 48 + COLLAPSED_PRIMARY_WIDTH + horizontalReach * 2);
    const containerHeight = Math.max(80, 52 + verticalReach * 2);

    useEffect(() => {
        // Fade in content
        mountAnim.value = withTiming(1, { duration: 400 });

        return () => {
            if (splitBridgeTimeoutRef.current) {
                clearTimeout(splitBridgeTimeoutRef.current);
            }
            if (splitSettleTimeoutRef.current) {
                clearTimeout(splitSettleTimeoutRef.current);
            }
            splitBridgeReadyToClearRef.current = false;
        };
    }, []);

    useEffect(() => {
        const previousQuotes = previousQuotesRef.current;
        const previousPrimaryStationId = previousQuotes?.[0]?.stationId;
        const currentPrimaryStationId = quotes?.[0]?.stationId;
        const isSamePrimary = previousPrimaryStationId && previousPrimaryStationId === currentPrimaryStationId;
        const isConnectionTransition =
            isSamePrimary &&
            previousQuotes.length < quotes.length &&
            quotes.length > 1;
        const isSplitTransition =
            isSamePrimary &&
            previousQuotes.length > quotes.length &&
            previousQuotes.length > 1;

        if (isSplitTransition) {
            const bridgePrimary = previousQuotes[0];
            const bridgeAnchoredQuotes = previousQuotes.map(quote => {
                const dx = (quote.longitude - bridgePrimary.longitude) * ptPerLng;
                const dy = -(quote.latitude - bridgePrimary.latitude) * ptPerLat;
                return {
                    ...quote,
                    dx,
                    dy,
                    distanceFromPrimary: Math.hypot(dx, dy),
                };
            });
            const bridgeSecondaryQuotes = bridgeAnchoredQuotes.slice(1);
            const bridgeStartQuote = bridgeSecondaryQuotes.length > 0
                ? bridgeSecondaryQuotes.reduce((farthestQuote, quote) => (
                    quote.distanceFromPrimary > farthestQuote.distanceFromPrimary ? quote : farthestQuote
                ), bridgeSecondaryQuotes[0])
                : null;
            const currentStationIds = new Set(quotes.map(quote => quote.stationId));
            const detachedBridgeQuote = bridgeSecondaryQuotes.find(quote => !currentStationIds.has(quote.stationId)) || bridgeStartQuote;

            if (bridgeStartQuote && detachedBridgeQuote) {
                const currentSpreadValue = spreadAnim.value;
                const currentMorphValue = morphAnim.value;
                const splitSettleDelay = Math.round(CHIP_ANIMATION_DURATION * 0.8);
                const bridgeStartX = interpolate(
                    currentSpreadValue,
                    [0, 1],
                    [COLLAPSED_BUBBLE_OFFSET, bridgeStartQuote.dx]
                );
                const bridgeStartY = interpolate(
                    currentSpreadValue,
                    [0, 1],
                    [0, bridgeStartQuote.dy]
                );

                if (splitBridgeTimeoutRef.current) {
                    clearTimeout(splitBridgeTimeoutRef.current);
                }
                if (splitSettleTimeoutRef.current) {
                    clearTimeout(splitSettleTimeoutRef.current);
                }
                splitBridgeReadyToClearRef.current = false;

                setSplitBridge({
                    plusCount: Math.max(0, previousQuotes.length - 1),
                    emergingQuote: detachedBridgeQuote,
                    startX: bridgeStartX,
                    startY: bridgeStartY,
                });
                splitBridgeProgress.value = 0;
                splitBridgeMorph.value = currentMorphValue;
                splitBridgeProgress.value = withTiming(1, { duration: CHIP_ANIMATION_DURATION });
                splitBridgeMorph.value = withTiming(1, { duration: CHIP_ANIMATION_DURATION });
                spreadAnim.value = currentSpreadValue;
                morphAnim.value = currentMorphValue;
                splitSettleTimeoutRef.current = setTimeout(() => {
                    spreadAnim.value = withTiming(resolvedSpread, { duration: CHIP_ANIMATION_DURATION });
                    morphAnim.value = withTiming(resolvedMorph, { duration: CHIP_ANIMATION_DURATION });
                    splitSettleTimeoutRef.current = null;
                }, splitSettleDelay);
                splitBridgeTimeoutRef.current = setTimeout(() => {
                    splitBridgeReadyToClearRef.current = true;
                    if (!isMapMoving) {
                        setSplitBridge(null);
                        splitBridgeReadyToClearRef.current = false;
                    }
                    splitBridgeTimeoutRef.current = null;
                }, CHIP_BRIDGE_CLEAR_DELAY);
            }
        }

        if (isConnectionTransition) {
            spreadAnim.value = 1;
            morphAnim.value = 1;
        }

        if (!isSplitTransition) {
            if (splitSettleTimeoutRef.current) {
                clearTimeout(splitSettleTimeoutRef.current);
                splitSettleTimeoutRef.current = null;
            }

            spreadAnim.value = withTiming(resolvedSpread, { duration: CHIP_ANIMATION_DURATION });
            morphAnim.value = withTiming(resolvedMorph, { duration: CHIP_ANIMATION_DURATION });
        }

        previousQuotesRef.current = quotes;
    }, [quotes, ptPerLng, ptPerLat, resolvedSpread, resolvedMorph, isMapMoving]);

    useEffect(() => {
        if (!splitBridge || isMapMoving || !splitBridgeReadyToClearRef.current) {
            return;
        }

        setSplitBridge(null);
        splitBridgeReadyToClearRef.current = false;
    }, [splitBridge, isMapMoving]);

    const animatedContentStyle = useAnimatedStyle(() => {
        return {};
    });

    // Style for the primary price bubble
    const leftBubbleStyle = useAnimatedStyle(() => {
        return {
            zIndex: 3,
            transform: [
                { translateX: 0 },
                { translateY: 0 }
            ]
        };
    });

    // Style for the breaking-out +N bubble
    const rightBubbleWrapperStyle = useAnimatedStyle(() => {
        return {
            zIndex: 2,
            transform: [
                { translateX: interpolate(spreadAnim.value, [0, 1], [COLLAPSED_BUBBLE_OFFSET, emergingAnchoredQuote?.dx ?? COLLAPSED_BUBBLE_OFFSET]) },
                { translateY: interpolate(spreadAnim.value, [0, 1], [0, emergingAnchoredQuote?.dy ?? 0]) }
            ]
        };
    });
    const rightBubbleShellStyle = useAnimatedStyle(() => {
        return {
            justifyContent: 'center',
            paddingHorizontal: interpolate(morphAnim.value, [0, 1], [8, 10], Extrapolate.CLAMP),
            paddingVertical: interpolate(morphAnim.value, [0, 0.5, 1], [6, 6, 6]),
            minWidth: interpolate(morphAnim.value, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP),
        };
    });

    // Style for the subgroup that stays clustered after one item peels away
    const remainderBubbleWrapperStyle = useAnimatedStyle(() => {
        const nextSecondaryLocalDx = nextClusterEmergingQuote
            ? interpolate(spreadAnim.value, [0, 1], [COLLAPSED_BUBBLE_OFFSET, nextClusterEmergingQuote.dx])
            : COLLAPSED_BUBBLE_OFFSET;
        const nextSecondaryLocalDy = nextClusterEmergingQuote
            ? interpolate(spreadAnim.value, [0, 1], [0, nextClusterEmergingQuote.dy])
            : 0;

        return {
            zIndex: 1,
            transform: [
                { translateX: nextSecondaryLocalDx },
                { translateY: nextSecondaryLocalDy }
            ]
        };
    });

    // Cross-fade styles for the text morphing
    const plusNStyle = useAnimatedStyle(() => {
        return {
            // Fade out the "+N" format 
            opacity: interpolate(morphAnim.value, [0.4, 0.8], [1, 0], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(morphAnim.value, [0.4, 0.8], [1, 0.5], Extrapolate.CLAMP) }]
        }
    });

    const escapingPriceStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            // Fade in the Price format
            opacity: interpolate(morphAnim.value, [0.6, 1], [0, 1], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(morphAnim.value, [0.6, 1], [0.8, 1], Extrapolate.CLAMP) }]
        }
    });
    const liveSplitBridgeTargetX = splitBridge
        ? (splitBridge.emergingQuote.longitude - primaryLng) * ptPerLng
        : 0;
    const liveSplitBridgeTargetY = splitBridge
        ? -(splitBridge.emergingQuote.latitude - primaryLat) * ptPerLat
        : 0;
    const splitBridgeBubbleStyle = useAnimatedStyle(() => {
        if (!splitBridge) {
            return {
                opacity: 0,
            };
        }

        return {
            zIndex: 4,
            transform: [
                {
                    translateX: interpolate(
                        splitBridgeProgress.value,
                        [0, 1],
                        [splitBridge.startX, liveSplitBridgeTargetX]
                    )
                },
                {
                    translateY: interpolate(
                        splitBridgeProgress.value,
                        [0, 1],
                        [splitBridge.startY, liveSplitBridgeTargetY]
                    )
                }
            ]
        };
    });
    const splitBridgeShellStyle = useAnimatedStyle(() => {
        return {
            justifyContent: 'center',
            paddingHorizontal: interpolate(splitBridgeMorph.value, [0, 1], [8, 10], Extrapolate.CLAMP),
            paddingVertical: 6,
            minWidth: interpolate(splitBridgeMorph.value, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP),
        };
    });
    const splitBridgePlusStyle = useAnimatedStyle(() => {
        return {
            opacity: interpolate(splitBridgeMorph.value, [0.4, 0.8], [1, 0], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(splitBridgeMorph.value, [0.4, 0.8], [1, 0.5], Extrapolate.CLAMP) }]
        };
    });
    const splitBridgePriceStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            opacity: interpolate(splitBridgeMorph.value, [0.6, 1], [0, 1], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(splitBridgeMorph.value, [0.6, 1], [0.8, 1], Extrapolate.CLAMP) }]
        };
    });
    return (
        <Marker
            key={quotes[0].stationId} // Ensure key is bound to primary station so it doesn't unmount
            coordinate={{
                latitude: primaryLat,
                longitude: primaryLng,
            }}
            anchor={{ x: 0.5, y: 0.5 }} // Keep anchor visually centered
            onPress={() => onMarkerPress(cluster)}
            style={{ zIndex: isActive ? 3 : isCheapestAcrossAll ? 2 : 1 }}
            tracksViewChanges={true}
        >
            <AnimatedLiquidGlassContainer
                spacing={24}
                style={[
                    styles.clusterContainer,
                    animatedOverlayStyle,
                    { minWidth: containerWidth, minHeight: containerHeight, justifyContent: 'center', alignItems: 'center' }
                ]}
            >
                {/* Main bubble with price (Front) */}
                <Animated.View style={[styles.bubblePositioner, leftBubbleStyle]}>
                    <AnimatedLiquidGlassView
                        effect="clear"
                        style={[styles.bubbleBase, styles.primaryBubbleShell]}
                    >
                        <Animated.View style={[styles.rowItem, styles.bubbleContentRow, animatedContentStyle]}>
                            <SymbolView
                                name="fuelpump.fill"
                                size={14}
                                tintColor={primaryQuote.originalIndex === 0 ? '#007AFF' : (primaryQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                style={styles.priceIcon}
                            />
                            <Animated.Text
                                style={[
                                    styles.priceText,
                                    primaryQuote.originalIndex === 0 && styles.bestPriceText,
                                    animatedTextStyle,
                                ]}
                            >
                                ${primaryQuote.price.toFixed(2)}
                            </Animated.Text>
                        </Animated.View>
                    </AnimatedLiquidGlassView>
                </Animated.View>

                {/* Secondary merging bubble for clusters (Behind) */}
                {isMultiQuote && (
                    <Animated.View style={[styles.bubblePositioner, rightBubbleWrapperStyle]}>
                        <AnimatedLiquidGlassView
                            effect="clear"
                            style={[
                                styles.bubbleBase,
                                rightBubbleShellStyle,
                            ]}
                        >
                            <Animated.View style={[styles.rowItem, animatedContentStyle, plusNStyle, { justifyContent: 'center' }]}>
                                <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
                                <Animated.Text
                                    style={[
                                        styles.priceText,
                                        animatedTextStyle,
                                    ]}
                            >
                                +{quotes.length - 1}
                            </Animated.Text>
                        </Animated.View>

                        {/* The price it morphs into */}
                        {emergingAnchoredQuote && (
                            <Animated.View style={[styles.rowItem, styles.bubbleFillRow, escapingPriceStyle]}>
                                <SymbolView
                                    name="fuelpump.fill"
                                    size={14}
                                    tintColor={emergingAnchoredQuote.originalIndex === 0 ? '#007AFF' : (emergingAnchoredQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                    style={styles.priceIcon}
                                />
                                <Text
                                    style={[
                                        styles.priceText,
                                        emergingAnchoredQuote.originalIndex === 0 && styles.bestPriceText,
                                        {
                                            color: emergingAnchoredQuote.originalIndex === 0
                                                ? '#007AFF'
                                                : (emergingAnchoredQuote.originalIndex === activeIndex ? themeColors.text : '#888888')
                                        }
                                    ]}
                                >
                                    ${emergingAnchoredQuote.price.toFixed(2)}
                                </Text>
                            </Animated.View>
                        )}
                        </AnimatedLiquidGlassView>
                    </Animated.View>
                )}

                {hasRemainderBubble && (
                    <Animated.View style={[styles.bubblePositioner, remainderBubbleWrapperStyle]}>
                        <AnimatedLiquidGlassView
                            effect="clear"
                            style={[
                                styles.bubbleBase,
                                rightBubbleShellStyle,
                                { justifyContent: 'center' }
                            ]}
                        >
                            <Animated.View style={[styles.rowItem, animatedContentStyle, plusNStyle, { justifyContent: 'center' }]}>
                                <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
                                <Animated.Text
                                    style={[
                                        styles.priceText,
                                        animatedTextStyle,
                                    ]}
                                >
                                    +{nextClusterQuotes.length - 1}
                                </Animated.Text>
                            </Animated.View>

                            {nextClusterEmergingQuote && (
                                <Animated.View style={[styles.rowItem, styles.bubbleFillRow, escapingPriceStyle]}>
                                    <SymbolView
                                        name="fuelpump.fill"
                                        size={14}
                                        tintColor={nextClusterEmergingQuote.originalIndex === 0 ? '#007AFF' : (nextClusterEmergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                        style={styles.priceIcon}
                                    />
                                    <Text
                                        style={[
                                            styles.priceText,
                                            nextClusterEmergingQuote.originalIndex === 0 && styles.bestPriceText,
                                            {
                                                color: nextClusterEmergingQuote.originalIndex === 0
                                                    ? '#007AFF'
                                                    : (nextClusterEmergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')
                                            }
                                        ]}
                                    >
                                        ${nextClusterEmergingQuote.price.toFixed(2)}
                                    </Text>
                                </Animated.View>
                            )}
                        </AnimatedLiquidGlassView>
                    </Animated.View>
                )}

                {splitBridge?.emergingQuote && (
                    <Animated.View style={[styles.bubblePositioner, splitBridgeBubbleStyle]}>
                        <AnimatedLiquidGlassView
                            effect="clear"
                            style={[
                                styles.bubbleBase,
                                splitBridgeShellStyle,
                            ]}
                        >
                            <Animated.View style={[styles.rowItem, animatedContentStyle, splitBridgePlusStyle, { justifyContent: 'center' }]}>
                                <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
                                <Animated.Text
                                    style={[
                                        styles.priceText,
                                        animatedTextStyle,
                                    ]}
                                >
                                    +{splitBridge.plusCount}
                                </Animated.Text>
                            </Animated.View>

                            <Animated.View style={[styles.rowItem, styles.bubbleFillRow, splitBridgePriceStyle]}>
                                <SymbolView
                                    name="fuelpump.fill"
                                    size={14}
                                    tintColor={splitBridge.emergingQuote.originalIndex === 0 ? '#007AFF' : (splitBridge.emergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                    style={styles.priceIcon}
                                />
                                <Text
                                    style={[
                                        styles.priceText,
                                        splitBridge.emergingQuote.originalIndex === 0 && styles.bestPriceText,
                                        {
                                            color: splitBridge.emergingQuote.originalIndex === 0
                                                ? '#007AFF'
                                                : (splitBridge.emergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')
                                        }
                                    ]}
                                >
                                    ${splitBridge.emergingQuote.price.toFixed(2)}
                                </Text>
                            </Animated.View>
                        </AnimatedLiquidGlassView>
                    </Animated.View>
                )}

            </AnimatedLiquidGlassContainer>
        </Marker>
    );
}

function AnimatedCardItem({ item, index, scrollX, itemWidth, isDark, benchmarkQuote, errorMsg, isRefreshing, themeColors }) {
    const animatedDimStyle = useAnimatedStyle(() => {
        if (isDark) return { opacity: 0 };

        const inputRange = [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth];
        const dimOpacity = interpolate(
            scrollX.value,
            inputRange,
            [0.3, 0, 0.3],
            Extrapolate.CLAMP
        );

        return { opacity: dimOpacity };
    });

    return (
        <View style={{ width: itemWidth, paddingHorizontal: 4 }}>
            <FuelSummaryCard
                benchmarkQuote={benchmarkQuote}
                errorMsg={errorMsg}
                isDark={isDark}
                isRefreshing={isRefreshing}
                quote={item}
                themeColors={themeColors}
                rank={index + 1}
            />
            {!isDark && (
                <Animated.View
                    pointerEvents="none"
                    style={[{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 4,
                        right: 4,
                        backgroundColor: '#000000',
                        borderRadius: 32
                    }, animatedDimStyle]}
                />
            )}
        </View>
    );
}

export default function HomeScreen() {
    const mapRef = useRef(null);
    const flatListRef = useRef(null);
    const isMountedRef = useRef(true);
    const lastClusterDebugSignatureRef = useRef('');
    const clusterDebugSamplesRef = useRef([]);
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { preferences } = usePreferences();
    const debugClusterAnimations = __DEV__ && Boolean(preferences.debugClusterAnimations);
    const { fuelResetToken, manualLocationOverride, setFuelDebugState } = useAppState();
    const [location, setLocation] = useState(DEFAULT_REGION);
    const [bestQuote, setBestQuote] = useState(null);
    const [topStations, setTopStations] = useState([]);
    const [regionalQuotes, setRegionalQuotes] = useState([]);
    const [errorMsg, setErrorMsg] = useState(null);
    const [isLoadingLocation, setIsLoadingLocation] = useState(true);
    const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
    const [hasLocationPermission, setHasLocationPermission] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
    const [isMapMoving, setIsMapMoving] = useState(false);
    const [isClusterDebugRecording, setIsClusterDebugRecording] = useState(false);
    const router = useRouter();
    const scrollX = useSharedValue(0);

    const USE_SHEET_UX = false; // Temporary toggle for the Form Sheet UX experiment

    const bottomPadding = insets.bottom + TAB_BAR_CLEARANCE + CARD_GAP;
    const horizontalPadding = {
        left: insets.left + SIDE_MARGIN,
        right: insets.right + SIDE_MARGIN,
    };
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const canopyEdgeLine = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.42)';

    const applySnapshot = snapshot => {
        if (!snapshot?.quote || !isMountedRef.current) {
            return;
        }

        startTransition(() => {
            setBestQuote(snapshot.quote);
            setTopStations(snapshot.topStations || []);
            setRegionalQuotes(snapshot.regionalQuotes || []);
        });
    };

    const clearVisibleFuelState = (nextError = null) => {
        startTransition(() => {
            setBestQuote(null);
            setTopStations([]);
            setRegionalQuotes([]);
        });
        setErrorMsg(nextError);
        setIsRefreshingPrices(false);
        setIsLoadingLocation(false);
    };

    const resolveCurrentLocation = async () => {
        if (manualLocationOverride) {
            const manualLatitude = Number(manualLocationOverride.latitude);
            const manualLongitude = Number(manualLocationOverride.longitude);
            const isManualLocationValid =
                Number.isFinite(manualLatitude) &&
                Number.isFinite(manualLongitude) &&
                manualLatitude >= -90 &&
                manualLatitude <= 90 &&
                manualLongitude >= -180 &&
                manualLongitude <= 180;

            if (!isManualLocationValid) {
                if (isMountedRef.current) {
                    const invalidLocationMessage = getFuelFailureMessage({
                        reason: 'invalid-manual-location',
                    });

                    setFuelDebugState({
                        input: {
                            fuelType: 'regular',
                            latitude: manualLocationOverride.latitude,
                            longitude: manualLocationOverride.longitude,
                            locationSource: 'manual',
                            radiusMiles: 10,
                            zipCode: null,
                        },
                        providers: [],
                        requestedAt: new Date().toISOString(),
                    });
                    clearVisibleFuelState(invalidLocationMessage);
                }
                return null;
            }

            const manualRegion = {
                latitude: manualLatitude,
                longitude: manualLongitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };

            if (isMountedRef.current) {
                setHasLocationPermission(false);
                setLocation(manualRegion);
                if (mapRef.current) {
                    setMapMotionState(true);
                    mapRef.current.animateToRegion(manualRegion, 550);
                }
                setIsLoadingLocation(false);
            }

            return {
                ...manualRegion,
                locationSource: 'manual',
            };
        }

        if (!bestQuote) {
            setIsLoadingLocation(true);
        }

        try {
            const permissionState = await Location.getForegroundPermissionsAsync();
            let permissionStatus = permissionState.status;

            if (permissionStatus !== 'granted') {
                const requestedState = await Location.requestForegroundPermissionsAsync();
                permissionStatus = requestedState.status;
            }

            if (permissionStatus !== 'granted') {
                if (isMountedRef.current) {
                    setHasLocationPermission(false);
                    clearVisibleFuelState('Location permission was denied. Allow location to search for the cheapest nearby fuel.');
                }
                return null;
            }

            if (isMountedRef.current) {
                setHasLocationPermission(true);
            }

            const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });

            if (!isMountedRef.current) {
                return null;
            }

            const nextRegion = {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };

            setLocation(nextRegion);
            if (mapRef.current) {
                setMapMotionState(true);
                mapRef.current.animateToRegion(nextRegion, 550);
            }

            return nextRegion;
        } catch (error) {
            if (isMountedRef.current) {
                setHasLocationPermission(false);
                clearVisibleFuelState('Unable to get your current location. In the iOS Simulator, set a location in Features > Location.');
            }
            return null;
        } finally {
            if (isMountedRef.current) {
                setIsLoadingLocation(false);
            }
        }
    };

    const loadFuelData = async ({ latitude, longitude, locationSource, preferCached }) => {
        const query = {
            latitude,
            longitude,
            radiusMiles: preferences.searchRadiusMiles || 10,
            fuelType: preferences.preferredOctane || 'regular',
            preferredProvider: preferences.preferredProvider || 'gasbuddy',
        };
        const baseDebugState = {
            input: {
                ...query,
                locationSource,
                zipCode: null,
            },
            providers: [],
            requestedAt: new Date().toISOString(),
        };

        try {
            if (isMountedRef.current) {
                setFuelDebugState(baseDebugState);
            }

            if (preferCached) {
                const cachedSnapshot = await getCachedFuelPriceSnapshot(query);
                applySnapshot(cachedSnapshot);
            }

            if (isMountedRef.current) {
                setErrorMsg(null);
                setIsRefreshingPrices(true);
            }

            const result = await refreshFuelPriceSnapshot(query);
            const freshSnapshot = result?.snapshot;
            const nextDebugState = result?.debugState
                ? {
                    ...result.debugState,
                    input: {
                        ...result.debugState.input,
                        locationSource,
                    },
                }
                : baseDebugState;

            if (!freshSnapshot?.quote) {
                throw new Error('No prices returned');
            }

            applySnapshot(freshSnapshot);

            if (isMountedRef.current) {
                setErrorMsg(null);
                setFuelDebugState(nextDebugState);
            }
        } catch (error) {
            if (isMountedRef.current) {
                const nextDebugState = error?.debugState
                    ? {
                        ...error.debugState,
                        input: {
                            ...error.debugState.input,
                            locationSource,
                        },
                    }
                    : baseDebugState;

                setFuelDebugState(nextDebugState);
                clearVisibleFuelState(
                    error?.userMessage ||
                    getFuelFailureMessage({
                        debugState: nextDebugState,
                    })
                );
            }
        } finally {
            if (isMountedRef.current) {
                setIsRefreshingPrices(false);
            }
        }
    };

    const refreshForCurrentView = async ({ preferCached }) => {
        const nextRegion = await resolveCurrentLocation();

        if (!nextRegion) {
            return;
        }

        await loadFuelData({
            latitude: nextRegion.latitude,
            longitude: nextRegion.longitude,
            locationSource: nextRegion.locationSource || 'device',
            preferCached,
        });
    };

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!fuelResetToken) {
            return;
        }

        clearVisibleFuelState('Fuel cache cleared. Open Home to fetch fresh prices.');
        setFuelDebugState(null);
    }, [fuelResetToken]);

    useEffect(() => {
        if (!isFocused) {
            return;
        }

        void refreshForCurrentView({
            preferCached: true,
        });
    }, [isFocused, manualLocationOverride]);

    const onViewableItemsChanged = useRef(({ viewableItems }) => {
        if (viewableItems.length > 0) {
            setActiveIndex(viewableItems[0].index);
        }
    }).current;

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollX.value = event.contentOffset.x;
        },
    });

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 50,
    }).current;

    const minRating = preferences.minimumRating || 0;
    const stationQuotes = (topStations.length > 0 ? topStations : (bestQuote ? [bestQuote] : []))
        .filter(q => minRating === 0 || (q.rating != null && q.rating >= minRating))
        .map((q, idx) => ({ ...q, originalIndex: idx }));

    const previousClustersRef = useRef([]);

    const clusters = useMemo(() => {
        if (stationQuotes.length === 0) return [];

        const latDelta = mapRegion.latitudeDelta || 0.05;
        const lngDelta = mapRegion.longitudeDelta || 0.05;

        // Visual thresholds based on chip pixel dimensions
        const mergeLatHeight = latDelta * CLUSTER_MERGE_LAT_FACTOR;
        const mergeLngWidth = lngDelta * CLUSTER_MERGE_LNG_FACTOR;

        // Hysteresis: Keep absolute separation distance significantly wider
        // Use the same hysteresis multiplier the overlay animation uses.
        const splitLatHeight = mergeLatHeight * CLUSTER_SPLIT_MULTIPLIER;
        const splitLngWidth = mergeLngWidth * CLUSTER_SPLIT_MULTIPLIER;

        const cheapestStation = stationQuotes[0];
        const others = stationQuotes.slice(1);

        const finalClusters = [];

        // 1. Cheapest station is always standalone
        finalClusters.push({
            quotes: [cheapestStation],
            averageLat: cheapestStation.latitude,
            averageLng: cheapestStation.longitude,
        });

        // 2. Group all other overlapping stations together
        others.forEach(quote => {
            let grouped = false;
            for (const cluster of finalClusters) {
                // Don't group with the absolute cheapest standalone station
                if (cluster.quotes[0].originalIndex === 0) continue;

                // Check if they were already grouped together in the previous frame
                const wasPreviouslyGrouped = previousClustersRef.current.some(prevCluster =>
                    prevCluster.quotes.some(q => q.stationId === quote.stationId) &&
                    prevCluster.quotes.some(q => q.stationId === cluster.quotes[0].stationId)
                );

                const latDiff = Math.abs(cluster.averageLat - quote.latitude);
                const lngDiff = Math.abs(cluster.averageLng - quote.longitude);

                // If within physical overlap bounds, swallow into cluster
                // Use the wider split threshold if they were already grouped, otherwise use the tighter merge threshold
                const currentLatThreshold = wasPreviouslyGrouped ? splitLatHeight : mergeLatHeight;
                const currentLngThreshold = wasPreviouslyGrouped ? splitLngWidth : mergeLngWidth;

                if (latDiff < currentLatThreshold && lngDiff < currentLngThreshold) {
                    cluster.quotes.push(quote);
                    // Dynamically update center of mass
                    cluster.averageLat = cluster.quotes.reduce((sum, q) => sum + q.latitude, 0) / cluster.quotes.length;
                    cluster.averageLng = cluster.quotes.reduce((sum, q) => sum + q.longitude, 0) / cluster.quotes.length;
                    grouped = true;
                    break;
                }
            }

            if (!grouped) {
                finalClusters.push({
                    quotes: [quote],
                    averageLat: quote.latitude,
                    averageLng: quote.longitude,
                });
            }
        });

        // Ensure quotes inside clusters are sorted by price ascending (just in case)
        finalClusters.forEach(cluster => {
            if (cluster.quotes.length > 1) {
                cluster.quotes.sort((a, b) => a.price - b.price);
            }
        });

        previousClustersRef.current = finalClusters;
        return finalClusters;
    }, [stationQuotes, mapRegion.latitudeDelta, mapRegion.longitudeDelta]);

    const handleMarkerPress = (cluster) => {
        const primaryQuote = cluster.quotes[0];
        const index = primaryQuote.originalIndex;

        isUserScrollingRef.current = false; // Prevent map feedback loop
        flatListRef.current?.scrollToOffset({
            offset: index * itemWidth,
            animated: true,
        });
        setActiveIndex(index);

        // If it's a cluster, zoom in to naturally separate them
        if (cluster.quotes.length > 1 && mapRef.current) {
            // Find the maximum spread of the cluster to determine how far to zoom in
            const lats = cluster.quotes.map(q => q.latitude);
            const lngs = cluster.quotes.map(q => q.longitude);

            const maxLat = Math.max(...lats);
            const minLat = Math.min(...lats);
            const maxLng = Math.max(...lngs);
            const minLng = Math.min(...lngs);

            const latSpread = maxLat - minLat;
            const lngSpread = maxLng - minLng;

            // Zoom out far enough so we can comfortably see all separated icons around the center
            // A multiplier of 5-6 ensures the cluster spread occupies only a fraction of the screen, safely unmerging them
            const targetLatDelta = Math.max(latSpread * 6, 0.03);
            const targetLngDelta = Math.max(lngSpread * 6, 0.03);

            isAnimatingRef.current = true;
            setMapMotionState(true);
            mapRef.current.animateToRegion({
                latitude: cluster.averageLat,
                longitude: cluster.averageLng,
                latitudeDelta: targetLatDelta,
                longitudeDelta: targetLngDelta,
            }, 600);
        }
    };

    const { width, height } = Dimensions.get('window');

    // We want the card to be almost full width, minus some padding to peek the next card.
    const peekPadding = 16;
    const itemWidth = width - (peekPadding * 2);
    const sideInset = (width - itemWidth) / 2;

    const lastDataHashRef = useRef('');
    const isUserScrollingRef = useRef(false);
    const isAnimatingRef = useRef(false);
    const mapMotionRef = useRef(false);
    const prevIsFocusedRef = useRef(isFocused);

    const setMapMotionState = (moving) => {
        if (mapMotionRef.current === moving) {
            return;
        }

        mapMotionRef.current = moving;
        setIsMapMoving(moving);
    };

    const setMapRegionIfNeeded = (nextRegion) => {
        if (!nextRegion) {
            return;
        }

        setMapRegion(currentRegion => (
            areRegionsEquivalent(currentRegion, nextRegion)
                ? currentRegion
                : nextRegion
        ));
    };

    useEffect(() => {
        const wasFocused = prevIsFocusedRef.current;
        prevIsFocusedRef.current = isFocused;

        if (!mapRef.current || stationQuotes.length === 0 || isAnimatingRef.current) return;

        // Use ONLY stationQuotes for the data hash to avoid feedback loops from zooming
        const currentHash = stationQuotes.map(q => q.stationId).join(',');
        const isFocusGained = isFocused && !wasFocused;
        const isNewData = currentHash !== lastDataHashRef.current;

        if (isNewData || isFocusGained) {
            lastDataHashRef.current = currentHash;
            isUserScrollingRef.current = false;

            // Frame all stations (since clusters are dynamic and zoom-dependent)
            const coords = [
                { latitude: location.latitude, longitude: location.longitude },
                ...stationQuotes.filter(q => q.latitude && q.longitude).map(q => ({ latitude: q.latitude, longitude: q.longitude }))
            ];

            if (coords.length > 1) {
                isAnimatingRef.current = true;
                setTimeout(() => {
                    if (!mapRef.current) {
                        isAnimatingRef.current = false;
                        if (isMountedRef.current) {
                            setMapMotionState(false);
                        }
                        return;
                    }

                    setMapMotionState(true);
                    mapRef.current.fitToCoordinates(coords, {
                        edgePadding: { top: 120, right: 60, bottom: bottomPadding + 160, left: 60 },
                        animated: true,
                    });
                }, 100);
            }
        } else if (isUserScrollingRef.current && activeIndex >= 0 && activeIndex < stationQuotes.length) {
            const activeQuote = stationQuotes[activeIndex];
            if (activeQuote.latitude && activeQuote.longitude) {
                isAnimatingRef.current = true;
                setMapMotionState(true);
                mapRef.current.animateToRegion({
                    latitude: activeQuote.latitude,
                    longitude: activeQuote.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }, 400);
            }
        }
    }, [activeIndex, stationQuotes, location, bottomPadding, isFocused]);

    const fallbackCoordinate = {
        latitude: location.latitude,
        longitude: location.longitude,
    };
    const benchmarkQuote = regionalQuotes.find(quote => quote.providerId !== bestQuote?.providerId) || regionalQuotes[0] || null;
    const watchedCluster = useMemo(() => {
        if (!debugClusterAnimations) {
            return null;
        }

        const multiQuoteClusters = clusters.filter(cluster => cluster.quotes.length > 1);
        if (multiQuoteClusters.length === 0) {
            return null;
        }

        const latScale = mapRegion.latitudeDelta || 1;
        const lngScale = mapRegion.longitudeDelta || 1;

        return multiQuoteClusters.reduce((closestCluster, cluster) => {
            if (!closestCluster) {
                return cluster;
            }

            const clusterDistance = Math.hypot(
                (cluster.averageLat - mapRegion.latitude) / latScale,
                (cluster.averageLng - mapRegion.longitude) / lngScale
            );
            const closestDistance = Math.hypot(
                (closestCluster.averageLat - mapRegion.latitude) / latScale,
                (closestCluster.averageLng - mapRegion.longitude) / lngScale
            );

            return clusterDistance < closestDistance ? cluster : closestCluster;
        }, null);
    }, [debugClusterAnimations, clusters, mapRegion.latitude, mapRegion.longitude, mapRegion.latitudeDelta, mapRegion.longitudeDelta]);
    const watchedClusterDiagnostic = useMemo(() => {
        if (!debugClusterAnimations || !watchedCluster) {
            return null;
        }

        return computeClusterHandoffDiagnostic({
            quotes: watchedCluster.quotes,
            averageLat: watchedCluster.averageLat,
            averageLng: watchedCluster.averageLng,
            mapRegion,
            screenWidth: width,
            screenHeight: height,
        });
    }, [debugClusterAnimations, watchedCluster, mapRegion, width, height]);

    const pushClusterDebugSample = (cluster, diagnostic) => {
        if (!cluster || !diagnostic) {
            return false;
        }

        const clusterKey = cluster.quotes.map(quote => quote.stationId).join(', ');
        const signature = [
            clusterKey,
            diagnostic.summary,
            diagnostic.currentResolvedSpread.toFixed(3),
            diagnostic.nextResolvedSpread.toFixed(3),
            diagnostic.primarySwitchDistance.toFixed(3),
            diagnostic.secondarySwitchDistance.toFixed(3),
            diagnostic.nextPrimarySettleDistance.toFixed(3),
            diagnostic.nextSecondarySettleDistance.toFixed(3),
        ].join('|');

        if (signature === lastClusterDebugSignatureRef.current) {
            return false;
        }

        const plannedPrimaryMoveMagnitude = Math.hypot(
            diagnostic.plannedPrimaryMove?.dx || 0,
            diagnostic.plannedPrimaryMove?.dy || 0
        );
        const plannedSecondaryMoveMagnitude = Math.hypot(
            diagnostic.plannedSecondaryMove?.dx || 0,
            diagnostic.plannedSecondaryMove?.dy || 0
        );
        const mapLatitudeDelta = mapRegion?.latitudeDelta || 0;
        const mapLongitudeDelta = mapRegion?.longitudeDelta || 0;

        clusterDebugSamplesRef.current = [
            ...clusterDebugSamplesRef.current,
            {
                timestamp: Date.now(),
                clusterKey,
                clusterSize: cluster.quotes.length,
                summary: diagnostic.summary,
                causes: diagnostic.causes,
                currentResolvedSpread: diagnostic.currentResolvedSpread,
                currentResolvedMorph: diagnostic.currentResolvedMorph,
                nextMountSpread: diagnostic.nextMountSpread,
                nextMountMorph: diagnostic.nextMountMorph,
                nextResolvedSpread: diagnostic.nextResolvedSpread,
                nextResolvedMorph: diagnostic.nextResolvedMorph,
                primarySwitchDistance: diagnostic.primarySwitchDistance,
                secondarySwitchDistance: diagnostic.secondarySwitchDistance,
                nextPrimarySettleDistance: diagnostic.nextPrimarySettleDistance,
                nextSecondarySettleDistance: diagnostic.nextSecondarySettleDistance,
                centerShiftDistance: diagnostic.centerShiftDistance,
                shellWidthDelta: diagnostic.shellWidthDelta,
                plannedPrimaryMoveMagnitude,
                plannedSecondaryMoveMagnitude,
                mapLatitudeDelta,
                mapLongitudeDelta,
                splitLatThreshold: mapLatitudeDelta * CLUSTER_MERGE_LAT_FACTOR * CLUSTER_SPLIT_MULTIPLIER,
                splitLngThreshold: mapLongitudeDelta * CLUSTER_MERGE_LNG_FACTOR * CLUSTER_SPLIT_MULTIPLIER,
            },
        ];
        lastClusterDebugSignatureRef.current = signature;
        return true;
    };

    const handleStartClusterDebugRecording = () => {
        clusterDebugSamplesRef.current = [];
        lastClusterDebugSignatureRef.current = '';
        setIsClusterDebugRecording(true);

        if (watchedCluster && watchedClusterDiagnostic) {
            pushClusterDebugSample(watchedCluster, watchedClusterDiagnostic);
        }
    };

    const handleStopClusterDebugRecording = () => {
        const recordedSamples = clusterDebugSamplesRef.current;

        setIsClusterDebugRecording(false);
        lastClusterDebugSignatureRef.current = '';
        clusterDebugSamplesRef.current = [];
        console.debug(buildClusterDebugRecordingLog(recordedSamples));
    };

    useEffect(() => {
        if (!debugClusterAnimations) {
            setIsClusterDebugRecording(false);
            lastClusterDebugSignatureRef.current = '';
            clusterDebugSamplesRef.current = [];
            return;
        }

        if (!isClusterDebugRecording || !watchedCluster || !watchedClusterDiagnostic) {
            return;
        }

        pushClusterDebugSample(watchedCluster, watchedClusterDiagnostic);
    }, [debugClusterAnimations, isClusterDebugRecording, watchedCluster, watchedClusterDiagnostic]);

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                initialRegion={DEFAULT_REGION}
                provider={PROVIDER_APPLE}
                showsUserLocation={hasLocationPermission}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
                onRegionChange={(region) => {
                    setMapMotionState(true);
                    if (!isAnimatingRef.current) {
                        setMapRegionIfNeeded(region);
                    }
                }}
                onRegionChangeComplete={(region) => {
                    setMapRegionIfNeeded(region);
                    isAnimatingRef.current = false;
                    setMapMotionState(false);
                }}
            >
                {clusters.length > 0 ? (
                    clusters.map(cluster => (
                        <AnimatedMarkerOverlay
                            key={cluster.quotes[0].stationId}
                            cluster={cluster}
                            scrollX={scrollX}
                            itemWidth={itemWidth}
                            isDark={isDark}
                            themeColors={themeColors}
                            activeIndex={activeIndex}
                            onMarkerPress={handleMarkerPress}
                            mapRegion={mapRegion}
                            isMapMoving={isMapMoving}
                        />
                    ))
                ) : (
                    <Marker
                        coordinate={fallbackCoordinate}
                        title="No Prices Returned"
                        description={
                            errorMsg
                                ? 'No live station price available'
                                : isLoadingLocation
                                    ? 'Finding your location'
                                    : 'Checking fuel providers'
                        }
                        pinColor="#D46A4C"
                    />
                )}
            </MapView>

            <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />
            <BottomCanopy height={bottomPadding + 140} isDark={isDark} />

            <View
                style={[
                    styles.reloadButtonShell,
                    {
                        top: insets.top + 6,
                        left: horizontalPadding.left,
                    },
                ]}
            >
                <Pressable
                    disabled={isRefreshingPrices || isLoadingLocation}
                    onPress={() =>
                        void refreshForCurrentView({
                            preferCached: false,
                        })
                    }
                >
                    <GlassView
                        style={[
                            styles.reloadButton,
                            isRefreshingPrices || isLoadingLocation ? styles.reloadButtonDisabled : null,
                        ]}
                        tintColor={isDark ? '#000000' : '#FFFFFF'}
                        glassEffectStyle="clear"
                        key={isDark ? 'reload-dark' : 'reload-light'}
                    >
                        <Ionicons color={themeColors.text} name="refresh" size={16} />
                        <Text style={[styles.reloadButtonText, { color: themeColors.text }]}>Reload</Text>
                    </GlassView>
                </Pressable>
            </View>

            <View
                pointerEvents="none"
                style={[
                    styles.topHeader,
                    {
                        paddingTop: insets.top + 10,
                        paddingLeft: horizontalPadding.left,
                        paddingRight: horizontalPadding.right,
                    },
                ]}
            >
                <Text style={[styles.headerTitle, { color: themeColors.text }]}>Fuel Up</Text>
            </View>

            <View
                style={[
                    styles.contentOverlay,
                    {
                        bottom: bottomPadding,
                        justifyContent: 'center',
                        alignItems: 'center',
                    },
                ]}
            >
                {USE_SHEET_UX ? (
                    <Pressable
                        onPress={() => {
                            router.push({
                                pathname: '/prices-sheet',
                                params: {
                                    quotesData: stationQuotes.length > 0 ? JSON.stringify(stationQuotes) : JSON.stringify([bestQuote].filter(Boolean)),
                                    benchmarkData: benchmarkQuote ? JSON.stringify(benchmarkQuote) : null,
                                    errorMsg: errorMsg || '',
                                },
                            });
                        }}
                        style={{ width: itemWidth }}
                    >
                        <GlassView
                            tintColor={isDark ? '#000000' : '#FFFFFF'}
                            glassEffectStyle="clear"
                            style={styles.sheetTriggerButton}
                        >
                            <Text style={[styles.sheetTriggerText, { color: themeColors.text }]}>
                                {stationQuotes.length > 0 ? `View ${stationQuotes.length} Nearby Stations` : 'View Gas Stations'}
                            </Text>
                            <Ionicons name="chevron-up" size={20} color={themeColors.text} />
                        </GlassView>
                    </Pressable>
                ) : debugClusterAnimations ? (
                    <View style={{ width: width, paddingHorizontal: sideInset }}>
                        <ClusterDebugCard
                            cluster={watchedCluster}
                            diagnostic={watchedClusterDiagnostic}
                            isDark={isDark}
                            isRecording={isClusterDebugRecording}
                            onStartRecording={handleStartClusterDebugRecording}
                            onStopRecording={handleStopClusterDebugRecording}
                            themeColors={themeColors}
                        />
                    </View>
                ) : stationQuotes.length > 0 ? (
                    <Animated.FlatList
                        ref={flatListRef}
                        data={stationQuotes}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        decelerationRate="fast"
                        keyExtractor={(item, index) => item.stationId || index.toString()}
                        contentContainerStyle={{
                            paddingHorizontal: sideInset,
                            alignItems: 'center', // Fix bottom padding mismatch 
                        }}
                        snapToInterval={itemWidth} // Precise snapping prevents jitter
                        snapToAlignment="start"
                        disableIntervalMomentum={true}
                        onViewableItemsChanged={onViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        onScrollBeginDrag={() => { isUserScrollingRef.current = true; }}
                        onScroll={scrollHandler}
                        scrollEventThrottle={16}
                        renderItem={({ item, index }) => (
                            <AnimatedCardItem
                                item={item}
                                index={index}
                                scrollX={scrollX}
                                itemWidth={itemWidth}
                                isDark={isDark}
                                benchmarkQuote={benchmarkQuote}
                                errorMsg={errorMsg}
                                isRefreshing={isRefreshingPrices || isLoadingLocation}
                                themeColors={themeColors}
                            />
                        )}
                    />
                ) : (
                    <View style={{ width: width, paddingHorizontal: sideInset }}>
                        <FuelSummaryCard
                            benchmarkQuote={benchmarkQuote}
                            errorMsg={errorMsg}
                            isDark={isDark}
                            isRefreshing={isRefreshingPrices || isLoadingLocation}
                            quote={bestQuote}
                            themeColors={themeColors}
                        />
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topHeader: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 10,
    },
    contentOverlay: {
        position: 'absolute',
        width: '100%',
        alignItems: 'center',
    },
    sheetTriggerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 24,
        gap: 8,
    },
    sheetTriggerText: {
        fontSize: 17,
        fontWeight: '700',
    },
    reloadButtonShell: {
        position: 'absolute',
        zIndex: 2,
    },
    reloadButton: {
        minHeight: 42,
        paddingHorizontal: 14,
        borderRadius: 21,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    reloadButtonDisabled: {
        opacity: 0.72,
    },
    reloadButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    priceOverlay: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(150, 150, 150, 0.4)',
        overflow: 'hidden',
    },
    clusterContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
    },
    bubbleBase: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
    },
    primaryBubbleShell: {
        minWidth: COLLAPSED_PRIMARY_WIDTH,
        justifyContent: 'center',
    },
    bubblePositioner: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    rowItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bubbleContentRow: {
        justifyContent: 'center',
    },
    bubbleFillRow: {
        justifyContent: 'center',
        left: 0,
        right: 0,
    },
    priceText: {
        fontSize: 15,
        fontWeight: '700',
    },
    bestPriceText: {
        fontWeight: '900',
    },
    priceIcon: {
        marginRight: 2,
    },
});
