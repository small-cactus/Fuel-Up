import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, PROVIDER_APPLE } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import { LiquidGlassView } from '@callstack/liquid-glass';
import { MIN_SEARCH_RADIUS_MILES, MAX_SEARCH_RADIUS_MILES } from '../../lib/fuelSearchState';

function radiusRegion(coordinate, radius) {
    const latitudeDelta = radius * 1609.344 / 111000 * 2.8;
    return { ...coordinate, latitudeDelta, longitudeDelta: latitudeDelta / Math.max(0.2, Math.cos(coordinate.latitude * Math.PI / 180)) };
}

export default function RadiusStep({ isDark, themeColors, insets, value, onChange, coordinate, width, isActive = true }) {
    const map = useRef(null);
    const [fittedRadius, setFittedRadius] = useState(value);
    useEffect(() => {
        if (isActive && coordinate) map.current?.animateToRegion(radiusRegion(coordinate, fittedRadius));
    }, [coordinate, fittedRadius, isActive]);
    return (
        <View style={{ width, flex: 1, paddingBottom: insets.bottom + 100, backgroundColor: themeColors.background }}>
            <View style={[styles.header, { paddingTop: insets.top + 32 }]}>
                <Text style={[styles.title, { color: themeColors.text }]}>Search Nearby</Text>
                <Text style={[styles.subtitle, { color: themeColors.text }]}>How far would you go for a better price?</Text>
            </View>
            <View style={styles.mapContainer}>
                {coordinate ? (
                    <MapView ref={map} style={StyleSheet.absoluteFillObject} initialRegion={radiusRegion(coordinate, value)}
                        provider={PROVIDER_APPLE} showsUserLocation scrollEnabled={false} zoomEnabled={false}
                        pitchEnabled={false} rotateEnabled={false} userInterfaceStyle={isDark ? 'dark' : 'light'}>
                        <Circle center={coordinate} radius={value * 1609.344} strokeColor="#007AFF" strokeWidth={1.5} fillColor="rgba(0,122,255,0.08)" />
                    </MapView>
                ) : (
                    <Text style={[styles.subtitle, { color: themeColors.text, padding: 24 }]}>Your radius applies wherever you are. Enable location to preview your area.</Text>
                )}
            </View>
            <LiquidGlassView style={styles.controls} tintColor={isDark ? '#252525' : '#FFFFFF'}>
                <Text accessibilityLiveRegion="polite" style={[styles.value, { color: themeColors.text }]}>{value} mi</Text>
                <Slider testID="onboarding-radius" accessibilityLabel="Search radius in miles" accessibilityRole="adjustable"
                    minimumValue={MIN_SEARCH_RADIUS_MILES} maximumValue={MAX_SEARCH_RADIUS_MILES} step={1}
                    value={value} onValueChange={onChange} onSlidingComplete={setFittedRadius}
                    minimumTrackTintColor="#007AFF" style={styles.slider} />
                <View style={styles.range}><Text style={{ color: themeColors.text }}>2 mi</Text><Text style={{ color: themeColors.text }}>15 mi</Text></View>
            </LiquidGlassView>
        </View>
    );
}
const styles = StyleSheet.create({
    header: { alignItems: 'center', paddingHorizontal: 24, gap: 12, paddingBottom: 20 },
    title: { fontSize: 28, fontWeight: '800', fontFamily: 'ui-rounded' },
    subtitle: { fontSize: 16, opacity: 0.65, textAlign: 'center', lineHeight: 22 },
    mapContainer: { flex: 1, minHeight: 120, marginHorizontal: 24, borderRadius: 24, overflow: 'hidden', justifyContent: 'center' },
    controls: { margin: 24, padding: 20, borderRadius: 24 },
    value: { fontSize: 32, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
    slider: { height: 44, width: '100%' },
    range: { flexDirection: 'row', justifyContent: 'space-between', opacity: 0.6 },
});
