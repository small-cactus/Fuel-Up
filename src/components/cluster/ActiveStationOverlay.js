import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import {
  CLUSTER_PILL_HEIGHT,
  CLUSTER_PRIMARY_PILL_WIDTH,
} from '../../cluster/constants';
import { buildMapProjection } from '../../cluster/layout';

const BEST_PRICE_BLUE_LIGHT = '#007AFF';
const BEST_PRICE_BLUE_DARK = '#11f050ff';

function ActiveStationOverlay({
  quote,
  isBest = false,
  isDark = false,
  mapRegion,
  screenWidth,
  screenHeight,
  themeColors,
}) {
  const offset = useMemo(() => {
    if (
      !quote ||
      !Number.isFinite(quote.latitude) ||
      !Number.isFinite(quote.longitude) ||
      !mapRegion ||
      !Number.isFinite(mapRegion.latitude) ||
      !Number.isFinite(mapRegion.longitude)
    ) {
      return null;
    }

    const projection = buildMapProjection(mapRegion, screenWidth, screenHeight);
    const x = (quote.longitude - mapRegion.longitude) * projection.ptPerLng;
    const y = -(quote.latitude - mapRegion.latitude) * projection.ptPerLat;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return { x, y };
  }, [
    mapRegion,
    quote,
    screenHeight,
    screenWidth,
  ]);

  if (!quote || !Number.isFinite(quote.price) || !offset) {
    return null;
  }

  const tintColor = isBest
    ? (isDark ? BEST_PRICE_BLUE_DARK : BEST_PRICE_BLUE_LIGHT)
    : themeColors.text;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <View style={styles.overlayRoot}>
        <View
          style={[
            styles.positioner,
            {
              transform: [
                { translateX: offset.x },
                { translateY: offset.y },
              ],
            },
          ]}
        >
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
        </View>
      </View>
    </View>
  );
}

function arePropsEqual(previousProps, nextProps) {
  return (
    previousProps.quote === nextProps.quote &&
    previousProps.isBest === nextProps.isBest &&
    previousProps.isDark === nextProps.isDark &&
    previousProps.screenWidth === nextProps.screenWidth &&
    previousProps.screenHeight === nextProps.screenHeight &&
    previousProps.themeColors?.text === nextProps.themeColors?.text &&
    previousProps.mapRegion?.latitude === nextProps.mapRegion?.latitude &&
    previousProps.mapRegion?.longitude === nextProps.mapRegion?.longitude &&
    previousProps.mapRegion?.latitudeDelta === nextProps.mapRegion?.latitudeDelta &&
    previousProps.mapRegion?.longitudeDelta === nextProps.mapRegion?.longitudeDelta
  );
}

export default memo(ActiveStationOverlay, arePropsEqual);

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  positioner: {
    width: CLUSTER_PRIMARY_PILL_WIDTH,
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
