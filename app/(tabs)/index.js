import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_APPLE } from 'react-native-maps';
import { GlassView } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ThemeContext';

export default function HomeScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const [location, setLocation] = useState(null);
    const [errorMsg, setErrorMsg] = useState(null);

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setErrorMsg('Permission to access location was denied');
                return;
            }

            let loc = await Location.getCurrentPositionAsync({});
            setLocation({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            });
        })();
    }, []);

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            {location ? (
                <MapView
                    style={StyleSheet.absoluteFillObject}
                    initialRegion={location}
                    provider={PROVIDER_APPLE}
                    showsUserLocation={true}
                >
                    <Marker coordinate={location} title="Cheapest Gas" description="$3.15 / gal" />
                </MapView>
            ) : (
                <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}>
                    <ActivityIndicator size="large" />
                </View>
            )}

            {/* Invisible Top Header wrapper to avoid clipping but let map slide under */}
            <View style={{ paddingTop: insets.top, width: '100%', alignItems: 'center' }}>
                <Text style={{ fontSize: 24, fontWeight: '700', color: themeColors.text, marginBottom: 10 }}>Fuel Up</Text>
            </View>

            {/* Content properly displayed over the map in GlassView */}
            <View style={styles.contentOverlay}>
                <GlassView
                    style={styles.card}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'dark' : 'light'}
                >
                    <Text style={[styles.cardTitle, { color: themeColors.text }]}>Cheapest Nearby</Text>
                    <Text style={[styles.cardPrice, { color: themeColors.text }]}>$3.15 <Text style={{ fontSize: 14 }}>/gal</Text></Text>
                    <Text style={[styles.cardAddress, { color: themeColors.text }]}>123 Main St, Gas Station</Text>
                </GlassView>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    contentOverlay: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: 20,
    },
    card: {
        padding: 24,
        borderRadius: 32, // fully rounded edges, no hard corners
        overflow: 'hidden',
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 8,
    },
    cardPrice: {
        fontSize: 36,
        fontWeight: '800',
        marginBottom: 4,
    },
    cardAddress: {
        fontSize: 14,
        opacity: 0.7,
    }
});
