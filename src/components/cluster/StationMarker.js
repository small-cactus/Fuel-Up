import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { LiquidGlassView } from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolate,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  CLUSTER_PILL_HEIGHT,
  CLUSTER_PRIMARY_PILL_WIDTH,
} from '../../cluster/constants';

const APPEAR_START_SCALE = 0.58;
const APPEAR_DURATION_MS = 260;
const BEST_PRICE_BLUE_LIGHT = '#007AFF';
const BEST_PRICE_BLUE_DARK = '#11f050ff';
const INACTIVE_TEXT_DARK = '#F5F7FA';
const ONBOARDING_TINT_CHEAPEST = 'rgba(0, 255, 47, 0.3)';
const ONBOARDING_TINT_EXPENSIVE = 'rgba(255, 25, 0, 0.3)';
const AnimatedView = Animated.createAnimatedComponent(View);

function StationMarker({
  quote,
  isSuppressed = false,
  shouldDelaySuppression = false,
  isBest = false,
  isActive = false,
  isDark = false,
  onPress,
  useOnboardingColors = false,
}) {
  const appearProgress = useSharedValue(1);
  useEffect(() => {
    appearProgress.value = 0;
    appearProgress.value = withTiming(1, {
      duration: APPEAR_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
    return () => cancelAnimation(appearProgress);
  }, [appearProgress, quote?.stationId]);

  const appearStyle = useAnimatedStyle(() => ({
    transform: [{
      scale: interpolate(appearProgress.value, [0, 1], [APPEAR_START_SCALE, 1], Extrapolate.CLAMP),
    }],
  }), [appearProgress]);

  const inactiveIconTintColor = isDark ? '#D3D6DE' : '#888888';
  const inactiveTextColor = isDark ? INACTIVE_TEXT_DARK : '#888888';
  const bestTintColor = isDark ? BEST_PRICE_BLUE_DARK : BEST_PRICE_BLUE_LIGHT;

  let iconTintColor;
  let textColor;
  let glassTintColor;

  if (useOnboardingColors) {
    const plainColor = isDark ? '#FFFFFF' : '#000000';
    iconTintColor = plainColor;
    textColor = plainColor;
    glassTintColor = isBest ? ONBOARDING_TINT_CHEAPEST : ONBOARDING_TINT_EXPENSIVE;
  } else {
    iconTintColor = isBest ? bestTintColor : inactiveIconTintColor;
    textColor = isBest ? bestTintColor : inactiveTextColor;
    glassTintColor = undefined;
  }
  // Keep MapKit annotation identity stable when collision visibility changes.
  // A permanent custom subview prevents MapKit from substituting a default pin.
  // Only the glass content is removed: setting an ancestor alpha to zero breaks
  // native glass rendering when that same effect view is shown again.
  const suppressMarkerHit = isSuppressed && !isActive;
  const shouldShowContent = !suppressMarkerHit || shouldDelaySuppression;
  const markerZIndex = suppressMarkerHit ? -1 : (isActive ? 3 : (isBest ? 2 : 1));

  return (
    <Marker
      coordinate={{
        latitude: quote.latitude,
        longitude: quote.longitude,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={suppressMarkerHit ? undefined : () => onPress?.(quote)}
      tappable={!suppressMarkerHit}
      zIndex={markerZIndex}
    >
      <AnimatedView collapsable={false} accessible={false} style={[styles.markerFrame, appearStyle]}>
        {shouldShowContent ? (
          <LiquidGlassView effect="clear" tintColor={glassTintColor} style={styles.pillShell}>
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
        ) : null}
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
    previousProps.isActive === nextProps.isActive &&
    previousProps.isDark === nextProps.isDark &&
    previousProps.onPress === nextProps.onPress &&
    previousProps.useOnboardingColors === nextProps.useOnboardingColors
  );
}

export default memo(StationMarker, areStationMarkerPropsEqual);

const styles = StyleSheet.create({
  markerFrame: {
    width: CLUSTER_PRIMARY_PILL_WIDTH,
    height: CLUSTER_PILL_HEIGHT,
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
