import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import MapView, { Circle, Marker, PROVIDER_APPLE } from 'react-native-maps';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';

import { usePreferences } from '../PreferencesContext';
import { useTheme } from '../ThemeContext';
import TopCanopy from '../components/TopCanopy';
import BottomCanopy from '../components/BottomCanopy';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const OCTANE_OPTIONS = [
    { key: 'regular', label: 'Regular', octane: '87' },
    { key: 'midgrade', label: 'Midgrade', octane: '89' },
    { key: 'premium', label: 'Premium', octane: '93' },
];

// Demo coordinates: San Francisco
const DEMO_REGION = {
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.06,
    longitudeDelta: 0.06,
};

const DEMO_STATIONS = [
    { lat: 37.7760, lng: -122.4300, price: 3.89, name: 'Costco' },
    { lat: 37.7830, lng: -122.4120, price: 4.59, name: 'Chevron' },
    { lat: 37.7680, lng: -122.4250, price: 4.79, name: 'Shell' },
    { lat: 37.7800, lng: -122.4050, price: 4.65, name: '76' },
    { lat: 37.7710, lng: -122.4380, price: 4.49, name: 'Arco' },
    { lat: 37.7600, lng: -122.4180, price: 4.72, name: 'Valero' },
];

const MAP_MARGIN = 0.006; // Inset margin to avoid edge chips

function WelcomeStep({ isDark, themeColors, insets }) {
    const [visibleStations, setVisibleStations] = useState([]);
    const [cheapestRevealed, setCheapestRevealed] = useState(false);

    useEffect(() => {
        let i = 0;
        const interval = setInterval(() => {
            if (i < DEMO_STATIONS.length) {
                const currentIndex = i;
                setVisibleStations(prev => [...prev, DEMO_STATIONS[currentIndex]]);
                i++;
            } else {
                clearInterval(interval);
                setTimeout(() => setCheapestRevealed(true), 200);
            }
        }, 200);
        return () => clearInterval(interval);
    }, []);

    const cheapestPrice = Math.min(...DEMO_STATIONS.map(s => s.price));

    return (
        <View style={StyleSheet.absoluteFill}>
            {/* Full-screen map */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                initialRegion={DEMO_REGION}
                provider={PROVIDER_APPLE}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
            >
                {visibleStations.map((station, index) => {
                    const isCheapest = station.price === cheapestPrice;
                    // Skip off-screen stations
                    const latMin = DEMO_REGION.latitude - DEMO_REGION.latitudeDelta / 2 + MAP_MARGIN;
                    const latMax = DEMO_REGION.latitude + DEMO_REGION.latitudeDelta / 2 - MAP_MARGIN;
                    const lngMin = DEMO_REGION.longitude - DEMO_REGION.longitudeDelta / 2 + MAP_MARGIN;
                    const lngMax = DEMO_REGION.longitude + DEMO_REGION.longitudeDelta / 2 - MAP_MARGIN;
                    if (station.lat < latMin || station.lat > latMax || station.lng < lngMin || station.lng > lngMax) {
                        return null;
                    }

                    const chipTint = cheapestRevealed
                        ? (isCheapest ? '#168B57' : '#E35D4F')
                        : (isDark ? '#000000' : '#FFFFFF');

                    return (
                        <Marker
                            key={`demo-${index}`}
                            coordinate={{ latitude: station.lat, longitude: station.lng }}
                        >
                            <GlassView
                                glassEffectStyle="clear"
                                tintColor={chipTint}
                                key={`demo-${isDark ? 'dark' : 'light'}-${index}-${cheapestRevealed ? 'r' : 'u'}`}
                                style={[
                                    styles.demoChip,
                                    cheapestRevealed && isCheapest && styles.demoChipCheapest,
                                ]}
                            >
                                <SymbolView
                                    name="fuelpump.fill"
                                    size={14}
                                    tintColor={cheapestRevealed ? '#FFFFFF' : '#888888'}
                                    style={styles.demoChipIcon}
                                />
                                <Text style={[
                                    styles.demoChipText,
                                    { color: cheapestRevealed ? '#FFFFFF' : '#888888' },
                                    cheapestRevealed && isCheapest && styles.demoChipTextCheapest,
                                ]}>
                                    ${station.price.toFixed(2)}
                                </Text>
                            </GlassView>
                        </Marker>
                    );
                })}
            </MapView>

            {/* Blur canopies — extend further than gradients */}
            <TopCanopy edgeColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.42)'} height={insets.top + 300} isDark={isDark} topInset={0} />
            <BottomCanopy height={420} isDark={isDark} />

            {/* White gradients — shorter, sit inside the blur */}
            <LinearGradient
                colors={[isDark ? '#000000' : '#FFFFFF', isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)', isDark ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0)']}
                locations={[0, 0.5, 1]}
                style={[styles.topGradient, { height: insets.top + 220 }]}
                pointerEvents="none"
            />

            {/* Floating content over map */}
            <View style={[styles.welcomeOverlay, { paddingTop: insets.top + 40 }]} pointerEvents="none">
                <Image
                    source={require('../../assets/fuelup-icon.png')}
                    style={{ width: 64, height: 64, borderRadius: 14 }}
                    resizeMode="contain"
                />
                <Text style={[styles.appName, { color: themeColors.text }]}>Fuel Up</Text>
                <Text style={[styles.welcomeSubtitle, { color: themeColors.text }]}>
                    Find the cheapest gas near you, instantly.
                </Text>
            </View>
        </View>
    );
}

function RadiusStep({ isDark, themeColors, insets, value, onChange }) {
    const MILES_TO_METERS = 1609.34;
    const radiusMeters = value * MILES_TO_METERS;

    // Calculate map delta to fit the radius nicely (1 degree lat ≈ 111km)
    const latDelta = (radiusMeters / 111000) * 3.5;
    const region = {
        ...DEMO_REGION,
        latitudeDelta: Math.max(latDelta, 0.02),
        longitudeDelta: Math.max(latDelta, 0.02),
    };

    return (
        <View style={StyleSheet.absoluteFill}>
            {/* Full-screen map */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                region={region}
                provider={PROVIDER_APPLE}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
            >
                <Circle
                    center={{ latitude: DEMO_REGION.latitude, longitude: DEMO_REGION.longitude }}
                    radius={radiusMeters}
                    strokeColor="rgba(22, 139, 87, 0.5)"
                    strokeWidth={2}
                    fillColor="rgba(22, 139, 87, 0.08)"
                />
            </MapView>

            {/* Light top gradient — just enough for readability */}
            <LinearGradient
                colors={[isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)', isDark ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0)']}
                locations={[0, 1]}
                style={[styles.topGradient, { height: insets.top + 140 }]}
                pointerEvents="none"
            />

            {/* Light bottom gradient */}
            <LinearGradient
                colors={[isDark ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0)', isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)']}
                locations={[0, 1]}
                style={[styles.footerGradient, { height: 180 }]}
                pointerEvents="none"
            />

            {/* Floating header */}
            <View style={[styles.welcomeOverlay, { paddingTop: insets.top + 40 }]} pointerEvents="none">
                <SymbolView name="location.magnifyingglass" size={44} tintColor={themeColors.text} />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Search Radius</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    How far should we look for gas stations?
                </Text>
            </View>

            {/* Hero value centered on map */}
            <View style={styles.radiusHeroCenter} pointerEvents="none">
                <Text style={[styles.heroValue, { color: '#168B57', textShadowColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)', textShadowRadius: 12 }]}>{value} mi</Text>
            </View>

            {/* Slider at bottom */}
            <View style={[styles.radiusControls, { bottom: insets.bottom + 100 }]}>
                <GlassView
                    glassEffectStyle="regular"
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    key={isDark ? 'slider-dark' : 'slider-light'}
                    style={styles.sliderCard}
                >
                    <View style={styles.sliderLabels}>
                        <Text style={[styles.sliderLabel, { color: themeColors.text }]}>5 mi</Text>
                        <Text style={[styles.sliderLabel, { color: themeColors.text }]}>25 mi</Text>
                    </View>
                    <Slider
                        style={styles.slider}
                        minimumValue={5}
                        maximumValue={25}
                        step={1}
                        value={value}
                        onValueChange={onChange}
                        minimumTrackTintColor="#168B57"
                        maximumTrackTintColor={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}
                        thumbTintColor="#168B57"
                    />
                </GlassView>
            </View>
        </View>
    );
}

function OctaneStep({ isDark, themeColors, insets, value, onChange }) {
    return (
        <View style={styles.stepContainer}>
            <View style={[styles.stepHeader, { paddingTop: insets.top + 40 }]}>
                <SymbolView name="gauge.with.dots.needle.33percent" size={44} tintColor={themeColors.text} />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Preferred Octane</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    Which fuel grade do you usually get?
                </Text>
            </View>

            <View style={styles.stepContent}>
                <View style={styles.octaneOptions}>
                    {OCTANE_OPTIONS.map(option => {
                        const isSelected = value === option.key;
                        return (
                            <Pressable key={option.key} onPress={() => onChange(option.key)}>
                                <GlassView
                                    glassEffectStyle={isSelected ? 'regular' : 'clear'}
                                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                                    key={isDark ? `oct-dark-${option.key}` : `oct-light-${option.key}`}
                                    style={[
                                        styles.octaneCard,
                                        isSelected && { borderColor: '#168B57', borderWidth: 2 },
                                    ]}
                                >
                                    <Text style={[styles.octaneNumber, { color: isSelected ? '#168B57' : themeColors.text }]}>
                                        {option.octane}
                                    </Text>
                                    <Text style={[styles.octaneLabel, { color: themeColors.text }]}>
                                        {option.label}
                                    </Text>
                                </GlassView>
                            </Pressable>
                        );
                    })}
                </View>
            </View>
        </View>
    );
}

function RatingStep({ isDark, themeColors, insets, value, onChange }) {
    const ratingValues = [0, 3, 3.5, 4, 4.5];

    return (
        <View style={styles.stepContainer}>
            <View style={[styles.stepHeader, { paddingTop: insets.top + 40 }]}>
                <SymbolView name="star.fill" size={44} tintColor="#FFB800" />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Minimum Rating</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    Only show stations above a certain rating?
                </Text>
            </View>

            <View style={styles.stepContent}>
                <Text style={[styles.heroValue, { color: '#FFB800' }]}>
                    {value === 0 ? 'Show All' : `${value}+`}
                </Text>

                <View style={styles.segmentRow}>
                    {ratingValues.map(r => (
                        <Pressable key={r} onPress={() => onChange(r)}>
                            <GlassView
                                glassEffectStyle={r === value ? 'regular' : 'clear'}
                                tintColor={isDark ? '#000000' : '#FFFFFF'}
                                style={[
                                    styles.segmentButton,
                                    r === value && { borderColor: '#FFB800', borderWidth: 2 },
                                ]}
                            >
                                <Text style={[
                                    styles.segmentText,
                                    { color: r === value ? '#FFB800' : themeColors.text },
                                    r === value && { fontWeight: '700' },
                                ]}>
                                    {r === 0 ? 'All' : r}
                                </Text>
                            </GlassView>
                        </Pressable>
                    ))}
                </View>
            </View>
        </View>
    );
}

function LocationStep({ isDark, themeColors, insets, permissionStatus }) {
    return (
        <View style={styles.stepContainer}>
            <View style={[styles.stepHeader, { paddingTop: insets.top + 40 }]}>
                <SymbolView name="location.fill" size={44} tintColor="#007AFF" />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Enable Location</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    To find the absolute cheapest gas, we need to know where you are.
                </Text>
            </View>

            <View style={styles.stepContent}>
                <View style={styles.locationGraphicContainer}>
                    <View style={[styles.locationGraphicCircle, { backgroundColor: isDark ? 'rgba(0,122,255,0.15)' : 'rgba(0,122,255,0.1)' }]}>
                        <SymbolView name="mappin.and.ellipse" size={60} tintColor="#007AFF" />
                    </View>
                    <View style={styles.locationExplanation}>
                        <SymbolView name="info.circle.fill" size={16} tintColor={themeColors.text} style={{ opacity: 0.5 }} />
                        <Text style={[styles.locationExplanationText, { color: themeColors.text }]}>
                            Without location, we can't show real-time prices at stations around you.
                        </Text>
                    </View>
                </View>

                {permissionStatus === 'granted' && (
                    <View style={styles.grantedRow}>
                        <SymbolView name="checkmark.circle.fill" size={32} tintColor="#168B57" />
                        <Text style={[styles.grantedText, { color: '#168B57' }]}>Access Granted</Text>
                    </View>
                )}
            </View>
        </View>
    );
}

export default function OnboardingScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { preferences, updatePreference, completeOnboarding } = usePreferences();
    const [currentStep, setCurrentStep] = useState(0);
    const totalSteps = 5;

    const [radius, setRadius] = useState(preferences.searchRadiusMiles);
    const [octane, setOctane] = useState(preferences.preferredOctane);
    const [minRating, setMinRating] = useState(preferences.minimumRating);
    const [permissionStatus, setPermissionStatus] = useState(null);

    const handleRequestPermission = async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setPermissionStatus(status);
        if (status === 'granted') {
            setTimeout(() => setCurrentStep(currentStep + 1), 600);
        }
    };

    const handleContinue = () => {
        if (currentStep === 1 && permissionStatus !== 'granted') {
            handleRequestPermission();
            return;
        }

        if (currentStep < totalSteps - 1) {
            // Save preferences as we go
            if (currentStep === 2) updatePreference('searchRadiusMiles', radius);
            if (currentStep === 3) updatePreference('preferredOctane', octane);
            if (currentStep === 4) updatePreference('minimumRating', minRating);
            setCurrentStep(currentStep + 1);
        } else {
            // Final step
            completeOnboarding();
        }
    };

    const isLastStep = currentStep === totalSteps - 1;

    return (
        <View style={[styles.container, { backgroundColor: (currentStep === 0 || currentStep === 2) ? 'transparent' : themeColors.background }]}>
            <View style={styles.content}>
                {currentStep === 0 && <WelcomeStep isDark={isDark} themeColors={themeColors} insets={insets} />}
                {currentStep === 1 && <LocationStep isDark={isDark} themeColors={themeColors} insets={insets} permissionStatus={permissionStatus} />}
                {currentStep === 2 && <RadiusStep isDark={isDark} themeColors={themeColors} insets={insets} value={radius} onChange={setRadius} />}
                {currentStep === 3 && <OctaneStep isDark={isDark} themeColors={themeColors} insets={insets} value={octane} onChange={setOctane} />}
                {currentStep === 4 && <RatingStep isDark={isDark} themeColors={themeColors} insets={insets} value={minRating} onChange={setMinRating} />}
            </View>

            {/* Progress dots + continue */}
            {(currentStep === 0 || currentStep === 2) && (
                <LinearGradient
                    colors={[isDark ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0)', isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)', isDark ? '#000000' : '#FFFFFF']}
                    locations={[0, 0.4, 1]}
                    style={[styles.footerGradient, { paddingBottom: insets.bottom + 20 }]}
                    pointerEvents="box-none"
                />
            )}
            <View style={[styles.footer, (currentStep === 0 || currentStep === 2) && styles.footerAbsolute, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.dotsRow}>
                    {Array.from({ length: totalSteps }).map((_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.dot,
                                i === currentStep && styles.dotActive,
                                { backgroundColor: i === currentStep ? '#007AFF' : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)') },
                            ]}
                        />
                    ))}
                </View>

                {!isLastStep && (
                    <Pressable onPress={handleContinue} style={styles.continueButton}>
                        <GlassView
                            glassEffectStyle="regular"
                            tintColor="#007AFF"
                            isInteractive
                            style={styles.continueGlass}
                        >
                            <Text style={styles.continueText}>
                                {currentStep === 1 && permissionStatus !== 'granted' ? 'Enable Location' : 'Continue'}
                            </Text>
                            <SymbolView
                                name={currentStep === 1 && permissionStatus !== 'granted' ? 'location.fill' : 'arrow.right'}
                                size={18}
                                tintColor="#FFFFFF"
                            />
                        </GlassView>
                    </Pressable>
                )}

                {isLastStep && (
                    <Pressable onPress={handleContinue} style={styles.continueButton}>
                        <GlassView
                            glassEffectStyle="regular"
                            tintColor="#168B57"
                            isInteractive
                            style={styles.continueGlass}
                        >
                            <Text style={styles.continueText}>Get Started</Text>
                            <SymbolView name="checkmark" size={18} tintColor="#FFFFFF" />
                        </GlassView>
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
    },
    stepContainer: {
        flex: 1,
    },
    stepHeader: {
        alignItems: 'center',
        gap: 12,
    },
    stepContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 24,
    },
    heroValue: {
        fontSize: 56,
        fontWeight: '800',
        letterSpacing: -1,
    },
    sliderCard: {
        width: '100%',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderRadius: 20,
    },
    sliderLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    sliderLabel: {
        fontSize: 13,
        fontWeight: '600',
        opacity: 0.5,
    },
    slider: {
        width: '100%',
        height: 40,
    },
    // Welcome step
    welcomeOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        gap: 12,
    },
    appIconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    appName: {
        fontSize: 34,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    welcomeSubtitle: {
        fontSize: 17,
        opacity: 0.7,
        textAlign: 'center',
        maxWidth: 280,
    },
    demoChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(150, 150, 150, 0.4)',
        overflow: 'hidden',
    },
    demoChipCheapest: {
        borderColor: '#168B57',
        borderWidth: 2,
        transform: [{ scale: 1.2 }],
    },
    demoChipIcon: {
        marginRight: 2,
    },
    demoChipText: {
        fontSize: 15,
        fontWeight: '700',
    },
    demoChipTextCheapest: {
        fontWeight: '700',
    },
    // Steps shared
    stepTitle: {
        fontSize: 28,
        fontWeight: '800',
        textAlign: 'center',
        letterSpacing: -0.3,
    },
    stepSubtitle: {
        fontSize: 16,
        opacity: 0.6,
        textAlign: 'center',
        maxWidth: 300,
        lineHeight: 22,
    },
    segmentRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 8,
    },
    segmentButton: {
        width: 56,
        height: 56,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    segmentButtonActive: {
        borderColor: '#168B57',
        borderWidth: 2,
    },
    segmentText: {
        fontSize: 16,
        fontWeight: '600',
    },
    // Octane
    octaneOptions: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 16,
    },
    octaneCard: {
        width: (SCREEN_WIDTH - 96) / 3,
        paddingVertical: 24,
        borderRadius: 20,
        alignItems: 'center',
        gap: 6,
    },
    octaneNumber: {
        fontSize: 32,
        fontWeight: '800',
    },
    octaneLabel: {
        fontSize: 13,
        fontWeight: '600',
        opacity: 0.7,
    },
    // Location
    locationGraphicContainer: {
        alignItems: 'center',
        gap: 32,
    },
    locationGraphicCircle: {
        width: 140,
        height: 140,
        borderRadius: 70,
        alignItems: 'center',
        justifyContent: 'center',
    },
    locationExplanation: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        maxWidth: 320,
    },
    locationExplanationText: {
        fontSize: 15,
        fontWeight: '500',
        opacity: 0.6,
        lineHeight: 20,
    },
    grantedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(22, 139, 87, 0.1)',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 100,
    },
    grantedText: {
        fontSize: 16,
        fontWeight: '700',
    },
    skipText: {
        fontSize: 15,
        fontWeight: '600',
        opacity: 0.5,
    },
    // Footer
    footer: {
        alignItems: 'center',
        gap: 20,
        paddingHorizontal: 24,
    },
    footerAbsolute: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
    footerGradient: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 200,
    },
    topGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
    radiusHeroCenter: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    radiusControls: {
        position: 'absolute',
        left: 24,
        right: 24,
        alignItems: 'center',
        gap: 16,
    },
    dotsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    dotActive: {
        width: 24,
        borderRadius: 4,
    },
    continueButton: {
        width: '100%',
    },
    continueGlass: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 18,
        borderRadius: 20,
    },
    continueText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
    },
});
