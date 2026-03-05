import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { LiquidGlassView } from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolate,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  CLUSTER_PRIMARY_PILL_WIDTH,
  CLUSTER_PILL_HEIGHT,
  CLUSTER_RUNTIME_PHASE,
  CLUSTER_PROBE_TRANSITION_TYPES,
} from '../../cluster/constants';
import {
  buildClusterMembershipKey,
  buildMapProjection,
  buildOutsideTargets,
  computeAccumulatorAnchor,
} from '../../cluster/layout';
import {
  buildTransitionPlan,
} from '../../cluster/transitionEngine';

const AnimatedLiquidGlassView = Animated.createAnimatedComponent(LiquidGlassView);
const AnimatedText = Animated.createAnimatedComponent(Text);

function PricePill({ quote, isActive, isBest, isDark, themeColors, animatedTextStyle, showDivider = false, plusCount = null, plusOpacity = 1, priceOpacity = 1 }) {
  const tintColor = isBest
    ? '#007AFF'
    : (isActive ? themeColors.text : '#888888');

  return (
    <AnimatedLiquidGlassView effect="clear" style={styles.pillShell}>
      {plusCount != null ? (
        <Animated.View style={[styles.rowItem, { opacity: plusOpacity }]}>
          {showDivider ? (
            <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
          ) : null}
          <AnimatedText style={[styles.priceText, animatedTextStyle]}>+{plusCount}</AnimatedText>
        </Animated.View>
      ) : null}

      {quote ? (
        <Animated.View style={[styles.rowItem, styles.absoluteFill, { opacity: priceOpacity }]}>
          <SymbolView
            name="fuelpump.fill"
            size={14}
            tintColor={tintColor}
            style={styles.priceIcon}
          />
          <Text style={[styles.priceText, isBest && styles.bestPriceText, { color: tintColor }]}>${quote.price.toFixed(2)}</Text>
        </Animated.View>
      ) : null}
    </AnimatedLiquidGlassView>
  );
}

export default function ClusterMarkerOverlay({
  cluster,
  anchorCoordinate,
  isSuppressed = false,
  scrollX,
  itemWidth,
  isDark,
  themeColors,
  activeIndex,
  onMarkerPress,
  onDebugTransitionEvent,
  onDebugRenderFrame,
  isDebugWatched = false,
  isDebugRecording = false,
  mapRegion,
  isMapMoving = false,
}) {
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const previousClusterRef = useRef(null);
  const transitionRef = useRef({ fromClusterKey: '', toClusterKey: '', transitionKey: '' });
  const queueIndexRef = useRef(0);
  const mergeQueueRef = useRef([]);
  const splitQueueRef = useRef([]);
  const outsideHiddenIdsRef = useRef(new Set());
  const splitRevealByIdRef = useRef(new Map());
  const accumulatorCountRef = useRef(0);
  const [runtimePhase, setRuntimePhase] = useState(CLUSTER_RUNTIME_PHASE.LIVE);
  const [mergeMover, setMergeMover] = useState(null);
  const [splitMover, setSplitMover] = useState(null);
  const [accumulatorCount, setAccumulatorCount] = useState(0);
  const [outsideHiddenIds, setOutsideHiddenIds] = useState([]);
  const [splitRevealTargets, setSplitRevealTargets] = useState([]);
  const mergeProgress = useSharedValue(0);
  const splitProgress = useSharedValue(0);
  const suppressionProgress = useSharedValue(isSuppressed ? 1 : 0);

  useEffect(() => {
    accumulatorCountRef.current = accumulatorCount;
  }, [accumulatorCount]);

  useEffect(() => {
    suppressionProgress.value = withTiming(isSuppressed ? 1 : 0, {
      duration: 140,
      easing: Easing.out(Easing.cubic),
    });
  }, [isSuppressed, suppressionProgress]);

  const quotes = cluster.quotes;
  const primaryQuote = quotes[0];
  const anchorLat = typeof anchorCoordinate?.latitude === 'number'
    ? anchorCoordinate.latitude
    : (mapRegion?.latitude || 0);
  const anchorLng = typeof anchorCoordinate?.longitude === 'number'
    ? anchorCoordinate.longitude
    : (mapRegion?.longitude || 0);
  const projection = useMemo(() => buildMapProjection(mapRegion, screenWidth, screenHeight), [mapRegion, screenWidth, screenHeight]);
  const outsideTargets = useMemo(() => buildOutsideTargets(quotes, projection), [quotes, projection]);
  const accumulatorAnchor = computeAccumulatorAnchor();
  const anchorOffsetX = (anchorLng - (mapRegion?.longitude || 0)) * projection.ptPerLng;
  const anchorOffsetY = -(anchorLat - (mapRegion?.latitude || 0)) * projection.ptPerLat;
  const primaryOffsetX = (primaryQuote.longitude - anchorLng) * projection.ptPerLng;
  const primaryOffsetY = -(primaryQuote.latitude - anchorLat) * projection.ptPerLat;
  const baseOffsetX = anchorOffsetX + primaryOffsetX;
  const baseOffsetY = anchorOffsetY + primaryOffsetY;
  const hasValidPrimaryOffset = (
    Number.isFinite(anchorOffsetX) &&
    Number.isFinite(anchorOffsetY) &&
    Number.isFinite(primaryOffsetX) &&
    Number.isFinite(primaryOffsetY)
  );

  const mergeMoverStyle = useAnimatedStyle(() => {
    if (!mergeMover) {
      return { opacity: 0 };
    }

    return {
      opacity: 1,
      transform: [
        {
          translateX: baseOffsetX + interpolate(mergeProgress.value, [0, 1], [mergeMover.startX, mergeMover.endX]),
        },
        {
          translateY: baseOffsetY + interpolate(mergeProgress.value, [0, 1], [mergeMover.startY, mergeMover.endY]),
        },
      ],
    };
  }, [baseOffsetX, baseOffsetY, mergeMover]);

  const splitMoverStyle = useAnimatedStyle(() => {
    if (!splitMover) {
      return { opacity: 0 };
    }

    return {
      opacity: 1,
      transform: [
        {
          translateX: baseOffsetX + interpolate(splitProgress.value, [0, 1], [splitMover.startX, splitMover.endX]),
        },
        {
          translateY: baseOffsetY + interpolate(splitProgress.value, [0, 1], [splitMover.startY, splitMover.endY]),
        },
      ],
    };
  }, [baseOffsetX, baseOffsetY, splitMover]);

  const animatedTextStyle = useAnimatedStyle(() => {
    if (primaryQuote.originalIndex === 0) return { color: '#007AFF' };

    const baseIndex = primaryQuote.originalIndex;
    const inputRange = [(baseIndex - 1) * itemWidth, baseIndex * itemWidth, (baseIndex + 1) * itemWidth];
    const color = interpolateColor(scrollX.value, inputRange, ['#888888', themeColors.text, '#888888']);
    return { color };
  });

  const suppressionStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(suppressionProgress.value, [0, 1], [1, 0.72], Extrapolate.CLAMP) },
    ],
  }));

  const emitTransitionEvent = (event) => {
    onDebugTransitionEvent?.({
      ...event,
      primaryStationId: primaryQuote.stationId,
      fromClusterKey: transitionRef.current.fromClusterKey,
      toClusterKey: transitionRef.current.toClusterKey,
      transitionKey: transitionRef.current.transitionKey,
    });
  };

  const applyLiveClusterPresentation = () => {
    if (quotes.length <= 1) {
      outsideHiddenIdsRef.current = new Set();
      setOutsideHiddenIds([]);
      splitRevealByIdRef.current = new Map();
      setSplitRevealTargets([]);
      accumulatorCountRef.current = 0;
      setAccumulatorCount(0);
      return;
    }

    const hiddenIds = new Set(outsideTargets.map(target => String(target.stationId)));
    outsideHiddenIdsRef.current = hiddenIds;
    setOutsideHiddenIds(Array.from(hiddenIds));
    splitRevealByIdRef.current = new Map();
    setSplitRevealTargets([]);
    const nextCount = Math.max(0, quotes.length - 1);
    accumulatorCountRef.current = nextCount;
    setAccumulatorCount(nextCount);
  };

  const finishMergeSequence = () => {
    setMergeMover(null);
    applyLiveClusterPresentation();
    mergeQueueRef.current = [];
    queueIndexRef.current = 0;
    setRuntimePhase(CLUSTER_RUNTIME_PHASE.MERGE_COMPLETE);
    emitTransitionEvent({ type: CLUSTER_PROBE_TRANSITION_TYPES.MERGE_SEQUENCE_COMPLETE });
    setTimeout(() => setRuntimePhase(CLUSTER_RUNTIME_PHASE.LIVE), 34);
  };

  const handleMergeStepComplete = (moverStationId) => {
    queueIndexRef.current += 1;
    const nextCount = accumulatorCountRef.current + 1;
    accumulatorCountRef.current = nextCount;
    setAccumulatorCount(nextCount);
    emitTransitionEvent({
      type: CLUSTER_PROBE_TRANSITION_TYPES.MERGE_ACCUMULATOR_INCREMENT,
      accumulatorCount: nextCount,
      moverStationId,
    });
    setMergeMover(null);
    setTimeout(runMergeQueueStep, 16);
  };

  const runMergeQueueStep = () => {
    const queue = mergeQueueRef.current;
    const index = queueIndexRef.current;

    if (!queue[index]) {
      finishMergeSequence();
      return;
    }

    const item = queue[index];
    setRuntimePhase(CLUSTER_RUNTIME_PHASE.MERGE_ACTIVE);
    setMergeMover(item);
    mergeProgress.value = 0;
    emitTransitionEvent({
      type: CLUSTER_PROBE_TRANSITION_TYPES.MERGE_DUPLICATE_SPAWN,
      moverStationId: item.stationId,
      startX: item.startX,
      startY: item.startY,
      targetX: item.endX,
      targetY: item.endY,
    });

    mergeProgress.value = withTiming(1, {
      duration: item.durationMs,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      if (!finished) {
        return;
      }

      runOnJS(handleMergeStepComplete)(item.stationId);
    });
  };

  const finishSplitSequence = () => {
    setSplitMover(null);
    splitQueueRef.current = [];
    queueIndexRef.current = 0;
    setRuntimePhase(CLUSTER_RUNTIME_PHASE.SPLIT_HANDOFF);
    emitTransitionEvent({ type: CLUSTER_PROBE_TRANSITION_TYPES.SPLIT_HANDOFF_COMPLETE });
    setTimeout(() => {
      applyLiveClusterPresentation();
      setRuntimePhase(CLUSTER_RUNTIME_PHASE.LIVE);
    }, 48);
  };

  const settleMergeForIdleMap = () => {
    if (runtimePhase !== CLUSTER_RUNTIME_PHASE.MERGE_PREP && runtimePhase !== CLUSTER_RUNTIME_PHASE.MERGE_ACTIVE) {
      return;
    }

    const hiddenIds = new Set((outsideTargets || []).map(target => String(target.stationId)));
    outsideHiddenIdsRef.current = hiddenIds;
    setOutsideHiddenIds(Array.from(hiddenIds));
    mergeQueueRef.current = [];
    queueIndexRef.current = 0;
    cancelAnimation(mergeProgress);
    mergeProgress.value = 1;
    setMergeMover(null);
    const nextCount = Math.max(0, quotes.length - 1);
    accumulatorCountRef.current = nextCount;
    setAccumulatorCount(nextCount);
    setRuntimePhase(CLUSTER_RUNTIME_PHASE.MERGE_COMPLETE);
    emitTransitionEvent({ type: CLUSTER_PROBE_TRANSITION_TYPES.MERGE_SEQUENCE_COMPLETE });
    setTimeout(() => {
      applyLiveClusterPresentation();
      setRuntimePhase(CLUSTER_RUNTIME_PHASE.LIVE);
    }, 16);
  };

  const settleSplitForIdleMap = () => {
    if (runtimePhase !== CLUSTER_RUNTIME_PHASE.SPLIT_PREP && runtimePhase !== CLUSTER_RUNTIME_PHASE.SPLIT_ACTIVE) {
      return;
    }

    splitQueueRef.current = [];
    queueIndexRef.current = 0;
    cancelAnimation(splitProgress);
    splitProgress.value = 1;
    setSplitMover(null);
    setRuntimePhase(CLUSTER_RUNTIME_PHASE.SPLIT_HANDOFF);
    emitTransitionEvent({ type: CLUSTER_PROBE_TRANSITION_TYPES.SPLIT_HANDOFF_COMPLETE });
    setTimeout(() => {
      applyLiveClusterPresentation();
      setRuntimePhase(CLUSTER_RUNTIME_PHASE.LIVE);
    }, 16);
  };

  const handleSplitStepComplete = (moverStationId) => {
    const queue = splitQueueRef.current;
    const index = queueIndexRef.current;
    const item = queue[index];

    if (!item) {
      finishSplitSequence();
      return;
    }

    emitTransitionEvent({
      type: CLUSTER_PROBE_TRANSITION_TYPES.SPLIT_DUPLICATE_ARRIVE,
      moverStationId,
      handoffPositionDelta: 0,
      handoffSizeDelta: 0,
      handoffContentDelta: 0,
    });

    splitRevealByIdRef.current.set(String(item.stationId), item);
    setSplitRevealTargets(Array.from(splitRevealByIdRef.current.values()));
    setSplitMover(null);

    queueIndexRef.current += 1;
    const nextCount = Math.max(0, accumulatorCountRef.current - 1);
    accumulatorCountRef.current = nextCount;
    setAccumulatorCount(nextCount);

    setTimeout(runSplitQueueStep, 16);
  };

  const runSplitQueueStep = () => {
    const queue = splitQueueRef.current;
    const index = queueIndexRef.current;

    if (!queue[index]) {
      finishSplitSequence();
      return;
    }

    const item = queue[index];
    const remainingCount = queue.length - index;

    setRuntimePhase(CLUSTER_RUNTIME_PHASE.SPLIT_ACTIVE);
    setSplitMover({
      ...item,
      plusCount: Math.max(0, remainingCount),
    });
    splitProgress.value = 0;

    emitTransitionEvent({
      type: CLUSTER_PROBE_TRANSITION_TYPES.SPLIT_DUPLICATE_SPAWN,
      moverStationId: item.stationId,
      startX: item.startX,
      startY: item.startY,
      targetX: item.endX,
      targetY: item.endY,
      plusCount: Math.max(0, remainingCount),
    });

    splitProgress.value = withTiming(1, {
      duration: item.durationMs,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      if (!finished) {
        return;
      }

      runOnJS(handleSplitStepComplete)(item.stationId);
    });
  };

  useEffect(() => {
    if (isMapMoving) {
      return;
    }

    settleMergeForIdleMap();
    settleSplitForIdleMap();
  }, [isMapMoving, runtimePhase, outsideTargets, quotes.length]);

  useEffect(() => {
    const previousCluster = previousClusterRef.current;
    const previousKey = buildClusterMembershipKey(previousCluster);
    const nextKey = buildClusterMembershipKey(cluster);

    if (!previousCluster) {
      applyLiveClusterPresentation();
      previousClusterRef.current = cluster;
      return;
    }

    if (previousKey === nextKey) {
      return;
    }

    const plan = buildTransitionPlan({
      previousCluster,
      nextCluster: cluster,
      mapRegion,
      screenWidth,
      screenHeight,
    });

    transitionRef.current = {
      fromClusterKey: buildClusterMembershipKey(previousCluster),
      toClusterKey: buildClusterMembershipKey(cluster),
      transitionKey: plan.transitionKey,
    };

    if (plan.events.length > 0) {
      plan.events.forEach(event => emitTransitionEvent(event));
    }

    if (plan.type === 'merge' && plan.queue.length > 0) {
      mergeQueueRef.current = plan.queue;
      queueIndexRef.current = 0;
      setAccumulatorCount(Math.max(0, (previousCluster?.quotes?.length || 1) - 1));
      accumulatorCountRef.current = Math.max(0, (previousCluster?.quotes?.length || 1) - 1);
      const hiddenIds = new Set(outsideTargets.map(target => String(target.stationId)));
      outsideHiddenIdsRef.current = hiddenIds;
      setOutsideHiddenIds(Array.from(hiddenIds));
      setRuntimePhase(CLUSTER_RUNTIME_PHASE.MERGE_PREP);
      runMergeQueueStep();
    } else if (plan.type === 'split' && plan.queue.length > 0) {
      splitQueueRef.current = plan.queue;
      queueIndexRef.current = 0;
      setAccumulatorCount(Math.max(0, (previousCluster?.quotes?.length || 1) - 1));
      accumulatorCountRef.current = Math.max(0, (previousCluster?.quotes?.length || 1) - 1);
      splitRevealByIdRef.current = new Map();
      setSplitRevealTargets([]);
      setRuntimePhase(CLUSTER_RUNTIME_PHASE.SPLIT_PREP);
      runSplitQueueStep();
    } else {
      setRuntimePhase(CLUSTER_RUNTIME_PHASE.LIVE);
      setMergeMover(null);
      setSplitMover(null);
      applyLiveClusterPresentation();
    }

    previousClusterRef.current = cluster;
  }, [
    cluster,
    screenWidth,
    screenHeight,
  ]);

  useEffect(() => {
    if (!isDebugWatched || !isDebugRecording || !onDebugRenderFrame) {
      return undefined;
    }

    const frameTimer = setInterval(() => {
      const clusterKey = buildClusterMembershipKey(cluster);
      const stageSignature = transitionRef.current.transitionKey || clusterKey;
      const visibleOutsideTargets = outsideTargets.filter(target => !outsideHiddenIdsRef.current.has(String(target.stationId)));
      const outsideTrack = visibleOutsideTargets[0] || splitRevealTargets[0] || null;
      const mergeProgressValue = mergeProgress.value;
      const splitProgressValue = splitProgress.value;
      const mergeX = mergeMover
        ? interpolate(mergeProgressValue, [0, 1], [mergeMover.startX, mergeMover.endX], Extrapolate.CLAMP)
        : 0;
      const mergeY = mergeMover
        ? interpolate(mergeProgressValue, [0, 1], [mergeMover.startY, mergeMover.endY], Extrapolate.CLAMP)
        : 0;
      const splitX = splitMover
        ? interpolate(splitProgressValue, [0, 1], [splitMover.startX, splitMover.endX], Extrapolate.CLAMP)
        : 0;
      const splitY = splitMover
        ? interpolate(splitProgressValue, [0, 1], [splitMover.startY, splitMover.endY], Extrapolate.CLAMP)
        : 0;
      const accumulatorVisible = runtimePhase !== CLUSTER_RUNTIME_PHASE.LIVE || accumulatorCountRef.current > 0;

      onDebugRenderFrame({
        frameTimestamp: Date.now(),
        clusterKey,
        fromClusterKey: transitionRef.current.fromClusterKey,
        toClusterKey: transitionRef.current.toClusterKey,
        stageSignature,
        runtimePhase,
        clusterSize: quotes.length,
        spreadProgress: Math.min(1, Math.max(0, (outsideTrack ? Math.hypot(outsideTrack.x, outsideTrack.y) / 120 : 0))),
        morphProgress: splitMover ? splitProgressValue : (mergeMover ? mergeProgressValue : 1),
        bridgeProgress: Math.max(mergeProgressValue || 0, splitProgressValue || 0),
        maxSecondaryRadius: Math.max(
          outsideTrack ? Math.hypot(outsideTrack.x, outsideTrack.y) : 0,
          mergeMover ? Math.hypot(mergeX, mergeY) : 0,
          splitMover ? Math.hypot(splitX, splitY) : 0
        ),
        secondaryShellWidth: CLUSTER_PRIMARY_PILL_WIDTH,
        outsideVisible: Boolean(outsideTrack),
        outsideOpacity: outsideTrack ? 1 : 0,
        outsideX: outsideTrack ? outsideTrack.x : 0,
        outsideY: outsideTrack ? outsideTrack.y : 0,
        outsideShellWidth: CLUSTER_PRIMARY_PILL_WIDTH,
        outsidePlusOpacity: 0,
        outsidePriceOpacity: outsideTrack ? 1 : 0,
        accumulatorVisible,
        accumulatorOpacity: accumulatorVisible ? 1 : 0,
        accumulatorX: accumulatorAnchor.x,
        accumulatorY: accumulatorAnchor.y,
        accumulatorShellWidth: CLUSTER_PRIMARY_PILL_WIDTH,
        accumulatorPlusOpacity: accumulatorVisible ? 1 : 0,
        accumulatorPriceOpacity: 0,
        mergeMoverVisible: Boolean(mergeMover),
        mergeMoverOpacity: mergeMover ? 1 : 0,
        mergeMoverX: mergeMover ? mergeX : 0,
        mergeMoverY: mergeMover ? mergeY : 0,
        mergeMoverShellWidth: CLUSTER_PRIMARY_PILL_WIDTH,
        mergeMoverPlusOpacity: 0,
        mergeMoverPriceOpacity: mergeMover ? 1 : 0,
        splitMoverVisible: Boolean(splitMover),
        splitMoverOpacity: splitMover ? 1 : 0,
        splitMoverX: splitMover ? splitX : 0,
        splitMoverY: splitMover ? splitY : 0,
        splitMoverShellWidth: CLUSTER_PRIMARY_PILL_WIDTH,
        splitMoverPlusOpacity: splitMover ? Math.max(0, 1 - splitProgressValue * 1.6) : 0,
        splitMoverPriceOpacity: splitMover ? Math.max(0, Math.min(1, (splitProgressValue - 0.65) / 0.35)) : 0,
        mapMoving: Boolean(isMapMoving),
        containerLogicalLayer: mergeMover ? 'mergeMover' : (splitMover ? 'splitMover' : (accumulatorVisible ? 'accumulator' : (outsideTrack ? 'outside' : ''))),
        containerLogicalX: mergeMover ? mergeX : (splitMover ? splitX : (accumulatorVisible ? accumulatorAnchor.x : (outsideTrack ? outsideTrack.x : null))),
        containerLogicalY: mergeMover ? mergeY : (splitMover ? splitY : (accumulatorVisible ? accumulatorAnchor.y : (outsideTrack ? outsideTrack.y : null))),
        containerVisualLayer: mergeMover ? 'mergeMover' : (splitMover ? 'splitMover' : (outsideTrack ? 'outside' : (accumulatorVisible ? 'accumulator' : ''))),
        containerVisualX: mergeMover ? mergeX : (splitMover ? splitX : (outsideTrack ? outsideTrack.x : (accumulatorVisible ? accumulatorAnchor.x : null))),
        containerVisualY: mergeMover ? mergeY : (splitMover ? splitY : (outsideTrack ? outsideTrack.y : (accumulatorVisible ? accumulatorAnchor.y : null))),
      });
    }, 16);

    return () => {
      clearInterval(frameTimer);
    };
  }, [
    accumulatorAnchor.x,
    accumulatorAnchor.y,
    cluster,
    isDebugRecording,
    isDebugWatched,
    isMapMoving,
    mergeMover,
    onDebugRenderFrame,
    outsideTargets,
    quotes.length,
    runtimePhase,
    splitMover,
    splitRevealTargets,
  ]);

  const isActive = quotes.some(quote => quote.originalIndex === activeIndex);
  const isBest = quotes.some(quote => quote.originalIndex === 0);
  const hiddenOutsideSet = new Set(outsideHiddenIds);
  const renderedOutsideTargets = outsideTargets.filter(target => !hiddenOutsideSet.has(String(target.stationId)));

  if (!hasValidPrimaryOffset) {
    return null;
  }

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pillPositioner,
          styles.primaryPill,
          {
            transform: [
              { translateX: baseOffsetX },
              { translateY: baseOffsetY },
            ],
            zIndex: isActive ? 3 : isBest ? 2 : 1,
          },
        ]}
      >
        <Animated.View style={suppressionStyle}>
          <PricePill
            quote={primaryQuote}
            isActive={primaryQuote.originalIndex === activeIndex}
            isBest={primaryQuote.originalIndex === 0}
            isDark={isDark}
            themeColors={themeColors}
            animatedTextStyle={animatedTextStyle}
            priceOpacity={1}
          />
        </Animated.View>
      </Animated.View>

      {renderedOutsideTargets.map(target => (
        <Animated.View
          pointerEvents="none"
          key={`outside-${target.stationId}`}
          style={[
            styles.pillPositioner,
            {
              transform: [
                { translateX: baseOffsetX + target.x },
                { translateY: baseOffsetY + target.y },
              ],
            },
          ]}
        >
          <PricePill
            quote={target.quote}
            isActive={target.quote.originalIndex === activeIndex}
            isBest={target.quote.originalIndex === 0}
            isDark={isDark}
            themeColors={themeColors}
            animatedTextStyle={animatedTextStyle}
            priceOpacity={1}
          />
        </Animated.View>
      ))}

      {splitRevealTargets.map(target => (
        <Animated.View
          pointerEvents="none"
          key={`split-reveal-${target.stationId}`}
          style={[
            styles.pillPositioner,
            {
              transform: [
                { translateX: baseOffsetX + target.endX },
                { translateY: baseOffsetY + target.endY },
              ],
            },
          ]}
        >
          <PricePill
            quote={target.quote}
            isActive={target.quote.originalIndex === activeIndex}
            isBest={target.quote.originalIndex === 0}
            isDark={isDark}
            themeColors={themeColors}
            animatedTextStyle={animatedTextStyle}
            priceOpacity={1}
          />
        </Animated.View>
      ))}

      {(runtimePhase !== CLUSTER_RUNTIME_PHASE.LIVE || accumulatorCount > 0) ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pillPositioner,
            {
              transform: [
                { translateX: baseOffsetX + accumulatorAnchor.x },
                { translateY: baseOffsetY + accumulatorAnchor.y },
              ],
            },
          ]}
        >
          <PricePill
            quote={null}
            plusCount={Math.max(1, accumulatorCount)}
            showDivider
            isDark={isDark}
            themeColors={themeColors}
            animatedTextStyle={animatedTextStyle}
            plusOpacity={1}
            priceOpacity={0}
          />
        </Animated.View>
      ) : null}

      {mergeMover ? (
        <Animated.View pointerEvents="none" style={[styles.pillPositioner, mergeMoverStyle]}>
          <PricePill
            quote={mergeMover.quote}
            isActive={mergeMover.quote.originalIndex === activeIndex}
            isBest={mergeMover.quote.originalIndex === 0}
            isDark={isDark}
            themeColors={themeColors}
            animatedTextStyle={animatedTextStyle}
            priceOpacity={1}
          />
        </Animated.View>
      ) : null}

      {splitMover ? (
        <Animated.View pointerEvents="none" style={[styles.pillPositioner, splitMoverStyle]}>
          <PricePill
            quote={splitMover.quote}
            plusCount={splitMover.plusCount}
            showDivider
            isActive={splitMover.quote.originalIndex === activeIndex}
            isBest={splitMover.quote.originalIndex === 0}
            isDark={isDark}
            themeColors={themeColors}
            animatedTextStyle={animatedTextStyle}
            plusOpacity={Math.max(0, 1 - splitProgress.value * 1.6)}
            priceOpacity={Math.max(0, Math.min(1, (splitProgress.value - 0.65) / 0.35))}
          />
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pillPositioner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryPill: {
    zIndex: 4,
  },
  pillShell: {
    width: CLUSTER_PRIMARY_PILL_WIDTH,
    height: CLUSTER_PILL_HEIGHT,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: CLUSTER_PILL_HEIGHT / 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  absoluteFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  priceIcon: {
    marginRight: 2,
  },
  priceText: {
    fontSize: 15,
    fontWeight: '700',
  },
  bestPriceText: {
    color: '#007AFF',
  },
});
