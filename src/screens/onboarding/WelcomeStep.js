import { useState, useMemo } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import MapView, { PROVIDER_APPLE, Marker } from 'react-native-maps';
import { SCREEN_WIDTH, SCREEN_HEIGHT, DEMO_REGION } from './presentation.js';
import TopCanopy from '../../components/TopCanopy';
import BottomCanopy from '../../components/BottomCanopy';
import FuelUpHeaderLogo from '../../components/FuelUpHeaderLogo';
import ExamplePricePill from './ExamplePricePill';

export function WelcomeStep({ isDark, themeColors, insets, mapRegion }) {
    const [hasMapLoaded, setHasMapLoaded] = useState(false);
    const cheapestPrice = Math.min(...DEMO_STATIONS.map(s => s.price));
    const demoStations = useMemo(() => (
        DEMO_STATION_OFFSETS.map(station => ({
            ...station,
            lat: mapRegion.latitude + station.latOffset,
            lng: mapRegion.longitude + station.lngOffset,
        }))
    ), [mapRegion.latitude, mapRegion.longitude]);

    return (
        <View style={styles.stepContainer}>

            {/* Full-screen map */}
            <MapView
                style={{ position: 'absolute', width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                initialRegion={mapRegion}
                region={mapRegion}
                provider={PROVIDER_APPLE}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
                onMapLoaded={() => {
                    setHasMapLoaded(true);
                }}
                onRegionChangeComplete={() => {
                    setHasMapLoaded(currentValue => currentValue || true);
                }}
            >
                {hasMapLoaded ? demoStations.map((station, index) => {
                    const isCheapest = station.price === cheapestPrice;
                    const latMin = mapRegion.latitude - mapRegion.latitudeDelta / 2 + MAP_MARGIN;
                    const latMax = mapRegion.latitude + mapRegion.latitudeDelta / 2 - MAP_MARGIN;
                    const lngMin = mapRegion.longitude - mapRegion.longitudeDelta / 2 + MAP_MARGIN;
                    const lngMax = mapRegion.longitude + mapRegion.longitudeDelta / 2 - MAP_MARGIN;
                    if (station.lat < latMin || station.lat > latMax || station.lng < lngMin || station.lng > lngMax) {
                        return null;
                    }

                    return (
                        <Marker
                            key={`demo-${index}`}
                            coordinate={{ latitude: station.lat, longitude: station.lng }}
                            tracksViewChanges={true}
                        >
                            <OnboardingChip
                                price={station.price}
                                isCheapest={isCheapest}
                                isDark={isDark}
                                top={0}
                                left={0}
                            />
                        </Marker>
                    );
                }) : null}
            </MapView>

            <TopCanopy height={insets.top + 300} />
            <BottomCanopy height={270} />

            {/* Floating content over map */}
            <View style={[styles.welcomeOverlay, { paddingTop: insets.top + 40 }]} pointerEvents="none">
                <Image
                    source={require('../../../assets/fuelup-icon.png')}
                    style={{ width: 64, height: 64, borderRadius: 14 }}
                    resizeMode="contain"
                />
                <FuelUpHeaderLogo isDark={isDark} />
                <Text style={[styles.welcomeSubtitle, { color: themeColors.text }]}>
                    Find the cheapest gas near you, instantly.
                </Text>
            </View>
        </View>
    );
}

export const OnboardingChip = ({ price, isCheapest, isDark }) => (
    <ExamplePricePill price={`$${price.toFixed(2)}`} cheapest={isCheapest} isDark={isDark} pump />
);

export const DEMO_STATIONS = [
    { lat: 37.7760, lng: -122.4300, price: 3.89, name: 'Costco' },
    { lat: 37.7830, lng: -122.4120, price: 4.59, name: 'Chevron' },
    { lat: 37.7680, lng: -122.4250, price: 4.79, name: 'Shell' },
    { lat: 37.7800, lng: -122.4050, price: 4.65, name: '76' },
    { lat: 37.7710, lng: -122.4380, price: 4.49, name: 'Arco' },
    { lat: 37.7600, lng: -122.4180, price: 4.72, name: 'Valero' },
];

export const DEMO_STATION_OFFSETS = DEMO_STATIONS.map(station => ({
    ...station,
    latOffset: station.lat - DEMO_REGION.latitude,
    lngOffset: station.lng - DEMO_REGION.longitude,
}));

export const MAP_MARGIN = 0.006;

const styles = StyleSheet.create({
  stepContainer: {
    width: SCREEN_WIDTH,
    flex: 1,
    backgroundColor: 'transparent' // Default to transparent as children will provide it or parent will
  },
  // Welcome step
  welcomeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24
  },
  welcomeSubtitle: {
    fontSize: 17,
    opacity: 0.7,
    textAlign: 'center',
    maxWidth: 280
  }
});
