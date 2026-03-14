import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { LiquidGlassView } from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';
import Animated, {
  Easing,
  Extrapolate,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import {
  CLUSTER_PILL_HEIGHT,
  CLUSTER_PRIMARY_PILL_WIDTH,
} from '../../cluster/constants';

const SHRINK_DELAY_MS = 900;
const SHRINK_DURATION_MS = 150;
const SUPPRESSED_SCALE = 0.005;
const APPEAR_START_SCALE = 0.58;
const APPEAR_DURATION_MS = 260;
const TRACKS_VIEW_CHANGES_IDLE_MS = 180;
const BEST_PRICE_BLUE_LIGHT = '#007AFF';
const BEST_PRICE_BLUE_DARK = '#11f050ff';
const INACTIVE_TEXT_DARK = '#F5F7FA';
const AnimatedView = Animated.createAnimatedComponent(View);

function StationMarker({
  quote,
  isSuppressed = false,
  shouldDelaySuppression = false,
  isBest = false,
  isDark = false,
  onPress,
}) {
  const appearProgress = useSharedValue(1);
  const suppressionProgress = useSharedValue(isSuppressed && !shouldDelaySuppression ? 1 : 0);
  const tracksViewChangesTimeoutRef = useRef(null);
  const suppressionHideTimeoutRef = useRef(null);
  const visualStateSignatureRef = useRef('');
  const [tracksViewChanges, setTracksViewChanges] = useState(false);
  const [isContentHidden, setIsContentHidden] = useState(isSuppressed && !shouldDelaySuppression);

  useEffect(() => {
    return () => {
      if (tracksViewChangesTimeoutRef.current) {
        clearTimeout(tracksViewChangesTimeoutRef.current);
        tracksViewChangesTimeoutRef.current = null;
      }

      if (suppressionHideTimeoutRef.current) {
        clearTimeout(suppressionHideTimeoutRef.current);
        suppressionHideTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    appearProgress.value = 0;
    appearProgress.value = withTiming(1, {
      duration: APPEAR_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [appearProgress, quote?.stationId]);

  useEffect(() => {
    if (suppressionHideTimeoutRef.current) {
      clearTimeout(suppressionHideTimeoutRef.current);
      suppressionHideTimeoutRef.current = null;
    }

    if (isSuppressed) {
      setIsContentHidden(false);
      const delayMs = shouldDelaySuppression ? SHRINK_DELAY_MS : 0;
      suppressionProgress.value = withDelay(
        delayMs,
        withTiming(1, {
          duration: SHRINK_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        })
      );

      suppressionHideTimeoutRef.current = setTimeout(() => {
        suppressionHideTimeoutRef.current = null;
        setIsContentHidden(true);
      }, delayMs + SHRINK_DURATION_MS);
      return;
    }

    setIsContentHidden(false);
    suppressionProgress.value = withTiming(0, {
      duration: 120,
      easing: Easing.out(Easing.cubic),
    });
  }, [isSuppressed, shouldDelaySuppression, suppressionProgress]);

  const shrinkStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: (
          interpolate(
            appearProgress.value,
            [0, 1],
            [APPEAR_START_SCALE, 1],
            Extrapolate.CLAMP
          ) * interpolate(
            suppressionProgress.value,
            [0, 1],
            [1, SUPPRESSED_SCALE],
            Extrapolate.CLAMP
          )),
      },
    ],
  }), [appearProgress, suppressionProgress]);

  const inactiveIconTintColor = isDark ? '#D3D6DE' : '#888888';
  const inactiveTextColor = isDark ? INACTIVE_TEXT_DARK : '#888888';
  const bestTintColor = isDark ? BEST_PRICE_BLUE_DARK : BEST_PRICE_BLUE_LIGHT;
  const iconTintColor = isBest
    ? bestTintColor
    : inactiveIconTintColor;
  const textColor = isBest
    ? bestTintColor
    : inactiveTextColor;
  const visualStateSignature = [
    quote?.stationId ?? '',
    quote?.price ?? '',
    isSuppressed ? '1' : '0',
    shouldDelaySuppression ? '1' : '0',
    isContentHidden ? '1' : '0',
    isBest ? '1' : '0',
    isDark ? '1' : '0',
  ].join('|');

  useEffect(() => {
    if (visualStateSignatureRef.current === visualStateSignature) {
      return;
    }

    visualStateSignatureRef.current = visualStateSignature;
    setTracksViewChanges(true);

    if (tracksViewChangesTimeoutRef.current) {
      clearTimeout(tracksViewChangesTimeoutRef.current);
    }

    const trackingDuration = isSuppressed && shouldDelaySuppression
      ? Math.max(APPEAR_DURATION_MS, SHRINK_DELAY_MS + SHRINK_DURATION_MS) + TRACKS_VIEW_CHANGES_IDLE_MS
      : Math.max(APPEAR_DURATION_MS, SHRINK_DURATION_MS) + TRACKS_VIEW_CHANGES_IDLE_MS;

    tracksViewChangesTimeoutRef.current = setTimeout(() => {
      tracksViewChangesTimeoutRef.current = null;
      setTracksViewChanges(false);
    }, trackingDuration);
  }, [isBest, isContentHidden, isDark, isSuppressed, quote?.price, quote?.stationId, shouldDelaySuppression, visualStateSignature]);

  return (
    <Marker
      coordinate={{
        latitude: quote.latitude,
        longitude: quote.longitude,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={() => onPress?.(quote)}
      style={{ zIndex: isBest ? 2 : 1 }}
      tracksViewChanges={tracksViewChanges}
    >
      <AnimatedView style={shrinkStyle}>
        {isContentHidden ? (
          <View style={styles.hiddenPlaceholder} />
        ) : (
          <LiquidGlassView effect="clear" style={styles.pillShell}>
            <View style={styles.rowItem}>
              <SymbolView
                name="fuelpump.fill"
                size={14}
                tintColor={iconTintColor}
                style={styles.priceIcon}
              />
              <Text style={[styles.priceText, isBest && styles.bestPriceText, { color: textColor }]}>
                ${quote.price.toFixed(2)}
              </Text>
            </View>
          </LiquidGlassView>
        )}
      </AnimatedView>
    </Marker>
  );
}

function areStationMarkerPropsEqual(previousProps, nextProps) {
  return (
    previousProps.quote === nextProps.quote &&
    previousProps.isSuppressed === nextProps.isSuppressed &&
    previousProps.shouldDelaySuppression === nextProps.shouldDelaySuppression &&
    previousProps.isBest === nextProps.isBest &&
    previousProps.isDark === nextProps.isDark &&
    previousProps.onPress === nextProps.onPress
  );
}

export default memo(StationMarker, areStationMarkerPropsEqual);

const styles = StyleSheet.create({
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
  hiddenPlaceholder: {
    width: 1,
    height: 1,
    opacity: 0,
  },
  priceIcon: {
    marginRight: 2,
  },
  priceText: {
    fontSize: 15,
    fontWeight: '700',
  },
  bestPriceText: {
    color: BEST_PRICE_BLUE_LIGHT,
  },
});
