import React, { useEffect } from 'react';
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

export default function StationMarker({
  quote,
  isSuppressed = false,
  isActive = false,
  isBest = false,
  themeColors,
  onPress,
}) {
  const appearProgress = useSharedValue(0);
  const suppressionProgress = useSharedValue(0);

  useEffect(() => {
    ensureInitialShrinkDelayWindowTimer();
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

  const tintColor = isBest
    ? '#007AFF'
    : (isActive ? themeColors.text : '#888888');

  return (
    <Marker
      coordinate={{
        latitude: quote.latitude,
        longitude: quote.longitude,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress}
      style={{ zIndex: isActive ? 3 : isBest ? 2 : 1 }}
      tracksViewChanges
    >
      <AnimatedView style={shrinkStyle}>
        <LiquidGlassView effect="clear" style={styles.pillShell}>
          <View style={styles.rowItem}>
            <SymbolView
              name="fuelpump.fill"
              size={14}
              tintColor={tintColor}
              style={styles.priceIcon}
            />
            <Text style={[styles.priceText, isBest && styles.bestPriceText, { color: tintColor }]}>
              ${quote.price.toFixed(2)}
            </Text>
          </View>
        </LiquidGlassView>
      </AnimatedView>
    </Marker>
  );
}

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
    color: '#007AFF',
  },
});
