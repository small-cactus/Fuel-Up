import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { SymbolView } from 'expo-symbols';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  CLUSTER_PILL_HEIGHT,
} from '../../cluster/constants';

const BEST_PRICE_BLUE_LIGHT = '#007AFF';
const BEST_PRICE_BLUE_DARK = '#11f050ff';
const APPEAR_START_SCALE = 0.58;
const APPEAR_DURATION_MS = 260;
const TRACKS_VIEW_CHANGES_IDLE_MS = 180;
const AnimatedView = Animated.createAnimatedComponent(View);

function ActiveStationOverlay({
  quote,
  isBest = false,
  isDark = false,
  themeColors,
}) {
  if (
    !quote ||
    !Number.isFinite(quote.price) ||
    !Number.isFinite(quote.latitude) ||
    !Number.isFinite(quote.longitude)
  ) {
    return null;
  }

  const tintColor = isBest
    ? (isDark ? BEST_PRICE_BLUE_DARK : BEST_PRICE_BLUE_LIGHT)
    : themeColors.text;
  const appearProgress = useSharedValue(0);
  const tracksViewChangesTimeoutRef = useRef(null);
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    return () => {
      if (tracksViewChangesTimeoutRef.current) {
        clearTimeout(tracksViewChangesTimeoutRef.current);
        tracksViewChangesTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    appearProgress.value = 0;
    setTracksViewChanges(true);
    appearProgress.value = withTiming(1, {
      duration: APPEAR_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });

    if (tracksViewChangesTimeoutRef.current) {
      clearTimeout(tracksViewChangesTimeoutRef.current);
    }

    tracksViewChangesTimeoutRef.current = setTimeout(() => {
      tracksViewChangesTimeoutRef.current = null;
      setTracksViewChanges(false);
    }, APPEAR_DURATION_MS + TRACKS_VIEW_CHANGES_IDLE_MS);
  }, [appearProgress, quote?.stationId]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: APPEAR_START_SCALE + ((1 - APPEAR_START_SCALE) * appearProgress.value),
      },
    ],
  }), [appearProgress]);

  return (
    <Marker
      coordinate={{
        latitude: quote.latitude,
        longitude: quote.longitude,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
      style={styles.marker}
      tracksViewChanges={tracksViewChanges}
    >
      <AnimatedView pointerEvents="none" style={[styles.positioner, animatedStyle]}>
          <View style={styles.contentRow}>
            <SymbolView
              name="fuelpump.fill"
              size={14}
              tintColor={tintColor}
              style={styles.priceIcon}
            />
            <Text style={[styles.priceText, { color: tintColor }]}>
              ${quote.price.toFixed(2)}
            </Text>
          </View>
      </AnimatedView>
    </Marker>
  );
}

function arePropsEqual(previousProps, nextProps) {
  return (
    previousProps.quote === nextProps.quote &&
    previousProps.isBest === nextProps.isBest &&
    previousProps.isDark === nextProps.isDark &&
    previousProps.themeColors?.text === nextProps.themeColors?.text
  );
}

export default memo(ActiveStationOverlay, arePropsEqual);

const styles = StyleSheet.create({
  marker: {
    zIndex: 5,
  },
  positioner: {
    height: CLUSTER_PILL_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentRow: {
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
});
