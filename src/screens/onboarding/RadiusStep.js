import { t } from '../../localization';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, PROVIDER_APPLE } from 'react-native-maps';
import RadiusControl from './RadiusControl';

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
        <ScrollView style={{ width, flex: 1, backgroundColor: themeColors.background }}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 140 }} showsVerticalScrollIndicator={false}>
            <View style={[styles.header, { paddingTop: insets.top + 32 }]}>
                <Text style={[styles.title, { color: themeColors.text }]}>Search Nearby</Text>
                <Text style={[styles.subtitle, { color: themeColors.text }]}>{t("How far would you go for a better price?")}</Text>
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
            <View style={{ margin: 24 }}>
                <RadiusControl value={value} onChange={onChange} onComplete={setFittedRadius} isDark={isDark} themeColors={themeColors} />
            </View>
        </ScrollView>
    );
}
const styles = StyleSheet.create({
    header: { flexShrink: 0, alignItems: 'center', paddingHorizontal: 24, gap: 12, paddingBottom: 20 },
    title: { alignSelf: 'stretch', textAlign: 'center', fontSize: 28, fontWeight: '800', fontFamily: 'ui-rounded' },
    subtitle: { fontSize: 16, opacity: 0.65, textAlign: 'center', lineHeight: 22 },
    mapContainer: { flex: 1, minHeight: 180, marginHorizontal: 24, borderRadius: 24, overflow: 'hidden', justifyContent: 'center' },
});
