import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_APPLE } from 'react-native-maps';
import ExamplePricePill from '../ExamplePricePill';
import { SymbolView } from 'expo-symbols';
import { SCREEN_WIDTH, LIGHT_SCREEN_BACKGROUND } from '../presentation';

const EXAMPLE_REGION = {
    latitude: 37.7755, longitude: -122.4194,
    latitudeDelta: 0.018, longitudeDelta: 0.025,
};
const EXAMPLE_STOPS = [
    { id: 'usual', coordinate: { latitude: 37.7775, longitude: -122.426 }, price: '$4.29', label: 'Usual stop', cheaper: false },
    { id: 'better', coordinate: { latitude: 37.7725, longitude: -122.413 }, price: '$3.99', label: 'Better price', cheaper: true },
];

// An intentionally static illustration. Live driving detection belongs to the
// predictive service; onboarding must not run a simulated trip or camera loop.
export default function PredictiveFuelingStep({ insets, isDark }) {
    const textColor = isDark ? '#FFFFFF' : '#111111';
    return (
        <ScrollView testID="onboarding-predictive" style={{ width: SCREEN_WIDTH, backgroundColor: isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND }}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 150 }]}
            showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
                <SymbolView name="sparkles" size={36} tintColor="#007AFF" />
                <Text style={[styles.title, { color: textColor }]}>Predictive Fueling</Text>
                <Text style={[styles.subtitle, { color: textColor }]}>A better stop, along your drive.</Text>
            </View>
            <View style={styles.mapCard} accessible accessibilityLabel="Example: your usual stop costs $4.29 per gallon. A nearby stop costs $3.99, saving 30 cents per gallon.">
                <MapView testID="onboarding-predictive-map" style={StyleSheet.absoluteFillObject}
                    provider={PROVIDER_APPLE} initialRegion={EXAMPLE_REGION}
                    userInterfaceStyle={isDark ? 'dark' : 'light'} scrollEnabled={false} zoomEnabled={false}
                    rotateEnabled={false} pitchEnabled={false} showsCompass={false} showsPointsOfInterest={false}
                    accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {EXAMPLE_STOPS.map(stop => (
                        <Marker key={stop.id} coordinate={stop.coordinate} anchor={{ x: 0.5, y: 0.5 }}>
                            <ExamplePricePill price={stop.price} label={stop.label} cheapest={stop.cheaper} isDark={isDark} />
                        </Marker>
                    ))}
                </MapView>
            </View>
            <Text style={[styles.caption, { color: textColor }]}>Example prices · Save 30¢ per gallon</Text>
            <View style={styles.detail}>
                <SymbolView name="bell.badge.fill" size={24} tintColor="#007AFF" />
                <View style={styles.detailText}>
                    <Text style={[styles.detailTitle, { color: textColor }]}>Know before you stop</Text>
                    <Text style={[styles.detailBody, { color: textColor }]}>Get an alert when a better fuel stop is nearby. You choose where to go.</Text>
                </View>
            </View>
            <View style={styles.detail}>
                <SymbolView name="location.fill" size={24} tintColor="#007AFF" />
                <View style={styles.detailText}>
                    <Text style={[styles.detailTitle, { color: textColor }]}>Ready when you drive</Text>
                    <Text style={[styles.detailBody, { color: textColor }]}>Always-on location and Motion & Fitness help recognize your drives.</Text>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: { paddingHorizontal: 24, gap: 20 },
    header: { alignItems: 'center', gap: 12 },
    title: { fontSize: 28, fontWeight: '800', fontFamily: 'ui-rounded', textAlign: 'center' },
    subtitle: { fontSize: 17, lineHeight: 23, textAlign: 'center', opacity: 0.7 },
    mapCard: { height: 230, borderRadius: 24, overflow: 'hidden' },

    caption: { fontSize: 13, textAlign: 'center', opacity: 0.65, marginTop: -10 },
    detail: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    detailText: { flex: 1, gap: 5 },
    detailTitle: { fontSize: 17, fontWeight: '700' },
    detailBody: { fontSize: 15, lineHeight: 21, opacity: 0.7 },
});
