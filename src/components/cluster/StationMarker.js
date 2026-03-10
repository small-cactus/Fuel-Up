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
const APPEAR_START_SCALE = 0.84;
const APPEAR_DURATION_MS = 220;
const INITIAL_SHRINK_DELAY_WINDOW_MS = 2500;
const TRACKS_VIEW_CHANGES_IDLE_MS = 180;
const BEST_PRICE_BLUE_LIGHT = '#007AFF';
const BEST_PRICE_BLUE_DARK = '#11f050ff';
const INACTIVE_TEXT_DARK = '#F5F7FA';
const AnimatedView = Animated.createAnimatedComponent(View);
let isInitialShrinkDelayWindowOpen = true;
let hasStartedInitialShrinkDelayWindowTimer = false;

function ensureInitialShrinkDelayWindowTimer() {
  if (hasStartedInitialShrinkDelayWindowTimer) {
    return;
  }

  hasStartedInitialShrinkDelayWindowTimer = true;
  setTimeout(() => {
    isInitialShrinkDelayWindowOpen = false;
  }, INITIAL_SHRINK_DELAY_WINDOW_MS);
}

function StationMarker({
  quote,
  isSuppressed = false,
  isBest = false,
  isDark = false,
  themeColors,
  onPress,
}) {
  const appearProgress = useSharedValue(0);
  const suppressionProgress = useSharedValue(0);
  const tracksViewChangesTimeoutRef = useRef(null);
  const visualStateSignatureRef = useRef('');
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    ensureInitialShrinkDelayWindowTimer();

    return () => {
      if (tracksViewChangesTimeoutRef.current) {
        clearTimeout(tracksViewChangesTimeoutRef.current);
        tracksViewChangesTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    appearProgress.value = 0;
    appearProgress.value = withTiming(1, {
      duration: APPEAR_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [appearProgress]);

  useEffect(() => {
    if (isSuppressed) {
      const delayMs = isInitialShrinkDelayWindowOpen ? SHRINK_DELAY_MS : 0;
      suppressionProgress.value = withDelay(
        delayMs,
        withTiming(1, {
          duration: SHRINK_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        })
      );
      return;
    }

    suppressionProgress.value = withTiming(0, {
      duration: 120,
      easing: Easing.out(Easing.cubic),
    });
  }, [isSuppressed, suppressionProgress]);

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

    const trackingDuration = isSuppressed && isInitialShrinkDelayWindowOpen
      ? SHRINK_DELAY_MS + SHRINK_DURATION_MS + TRACKS_VIEW_CHANGES_IDLE_MS
      : Math.max(APPEAR_DURATION_MS, SHRINK_DURATION_MS) + TRACKS_VIEW_CHANGES_IDLE_MS;

    tracksViewChangesTimeoutRef.current = setTimeout(() => {
      tracksViewChangesTimeoutRef.current = null;
      setTracksViewChanges(false);
    }, trackingDuration);
  }, [isBest, isDark, isSuppressed, quote?.price, quote?.stationId, visualStateSignature]);

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
      </AnimatedView>
    </Marker>
  );
}

function areStationMarkerPropsEqual(previousProps, nextProps) {
  return (
    previousProps.quote === nextProps.quote &&
    previousProps.isSuppressed === nextProps.isSuppressed &&
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
