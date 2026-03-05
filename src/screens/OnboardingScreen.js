import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LiquidGlassView as GlassView, LiquidGlassContainerView } from '@callstack/liquid-glass';


import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import MapView, { Circle, Marker, PROVIDER_APPLE } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import Animated, {
    FadeIn,
    FadeInDown,
    FadeInUp,
    ZoomIn,
    SlideInDown,
    useSharedValue,
    useAnimatedStyle,
    useAnimatedProps,
    withTiming,
    withDelay,
    runOnJS,
    Easing
} from 'react-native-reanimated';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

import { usePreferences } from '../PreferencesContext';
import { useTheme } from '../ThemeContext';
import TopCanopy from '../components/TopCanopy';
import BottomCanopy from '../components/BottomCanopy';
import FuelUpHeaderLogo from '../components/FuelUpHeaderLogo';
import { registerForPushNotificationsAsync, savePushTokenToSupabase } from '../lib/notifications';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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
const LIGHT_SCREEN_BACKGROUND = '#f2f1f6';
const LIGHT_SCREEN_BACKGROUND_85 = 'rgba(242,241,246,0.85)';
const LIGHT_SCREEN_BACKGROUND_42 = 'rgba(242,241,246,0.42)';
const LIGHT_SCREEN_BACKGROUND_0 = 'rgba(242,241,246,0)';

const OnboardingChip = ({ price, isCheapest, isDark, top, left, isActive }) => {

    const chipTint = isCheapest ? 'rgba(0, 255, 47, 0.3)' : 'rgba(255, 25, 0, 0.3)';

    return (
        <View style={{
            position: 'absolute',
            top: `${top}%`,
            left: `${left}%`,
            zIndex: 10,
        }}>
            <GlassView
                tintColor={chipTint}
                effect="clear"
                colorScheme={isDark ? 'dark' : 'light'}
                interactive={false}
                style={styles.demoChip}
                key={isActive ? 'chip-active' : 'chip-inactive'}
            >

                <SymbolView
                    name="fuelpump.fill"
                    size={14}
                    tintColor={isDark ? '#FFFFFF' : '#000000'}
                    style={styles.demoChipIcon}
                />
                <Text style={[
                    styles.demoChipText,
                    { color: isDark ? '#FFFFFF' : '#000000' },
                    isCheapest && styles.demoChipTextCheapest,
                ]}>
                    ${price.toFixed(2)}
                </Text>
            </GlassView>
        </View>
    );
};

function WelcomeStep({ isDark, themeColors, insets }) {
    const cheapestPrice = Math.min(...DEMO_STATIONS.map(s => s.price));

    return (
        <View style={styles.stepContainer}>

            {/* Full-screen map */}
            <MapView
                style={{ position: 'absolute', width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                initialRegion={DEMO_REGION}
                provider={PROVIDER_APPLE}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
            >
                {DEMO_STATIONS.map((station, index) => {
                    const isCheapest = station.price === cheapestPrice;
                    // Skip off-screen stations
                    const latMin = DEMO_REGION.latitude - DEMO_REGION.latitudeDelta / 2 + MAP_MARGIN;
                    const latMax = DEMO_REGION.latitude + DEMO_REGION.latitudeDelta / 2 - MAP_MARGIN;
                    const lngMin = DEMO_REGION.longitude - DEMO_REGION.longitudeDelta / 2 + MAP_MARGIN;
                    const lngMax = DEMO_REGION.longitude + DEMO_REGION.longitudeDelta / 2 - MAP_MARGIN;
                    if (station.lat < latMin || station.lat > latMax || station.lng < lngMin || station.lng > lngMax) {
                        return null;
                    }

                    const chipTint = isCheapest ? 'rgba(0, 255, 47, 0.3)' : 'rgba(255, 25, 0, 0.3)';

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
                                top={0} // Not used in Marker
                                left={0} // Not used in Marker
                            />
                        </Marker>
                    );
                })}
            </MapView>

            {/* Blur canopies — extend further than gradients */}
            <TopCanopy edgeColor={isDark ? 'rgba(255,255,255,0.08)' : LIGHT_SCREEN_BACKGROUND_42} height={insets.top + 300} isDark={isDark} topInset={insets.top} />
            <BottomCanopy height={270} isDark={isDark} />

            {/* White gradients — shorter, sit inside the blur */}
            <LinearGradient
                colors={[isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND, isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85, isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0]}
                locations={[0, 0.5, 1]}
                style={[styles.topGradient, { height: insets.top + 220 }]}
                pointerEvents="none"
            />

            <LinearGradient
                colors={[isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0, isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85, isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND]}
                locations={[0, 0.8, 1.2]}
                style={[styles.footerGradient, { height: 280 }]}
                pointerEvents="none"
            />

            {/* Floating content over map */}
            <View style={[styles.welcomeOverlay, { paddingTop: insets.top + 40 }]} pointerEvents="none">
                <Image
                    source={require('../../assets/fuelup-icon.png')}
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
        <View style={styles.stepContainer}>

            {/* Full-screen map */}
            <MapView
                style={{ position: 'absolute', width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                initialRegion={region}
                region={region}
                provider={PROVIDER_APPLE}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
            >
                <Circle
                    center={{ latitude: DEMO_REGION.latitude, longitude: DEMO_REGION.longitude }}
                    radius={radiusMeters}
                    strokeColor="rgba(0, 122, 255, 0.5)"
                    strokeWidth={2}
                    fillColor="rgba(0, 122, 255, 0.08)"
                />
            </MapView>

            {/* Blur canopies — extend further than gradients */}
            <TopCanopy edgeColor={isDark ? 'rgba(255,255,255,0.08)' : LIGHT_SCREEN_BACKGROUND_42} height={insets.top + 300} isDark={isDark} topInset={insets.top} />
            <BottomCanopy height={270} isDark={isDark} />

            {/* White gradients — shorter, sit inside the blur */}
            <LinearGradient
                colors={[isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND, isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85, isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0]}
                locations={[0, 0.5, 1]}
                style={[styles.topGradient, { height: insets.top + 220 }]}
                pointerEvents="none"
            />

            {/* Light bottom gradient */}
            <LinearGradient
                colors={[isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0, isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85, isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND]}
                locations={[0, 0.5, 1]}
                style={[styles.footerGradient, { height: 280 }]}
                pointerEvents="none"
            />

            {/* Floating header */}
            <View style={[styles.welcomeOverlay, { paddingTop: insets.top + 40 }]} pointerEvents="none">
                <SymbolView name="location.magnifyingglass" size={44} tintColor={themeColors.text} />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Search Radius</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    How far should we look for gas stations? This will affect the stations we recommend.
                </Text>
            </View>

            {/* Hero value centered on map */}
            <View style={styles.radiusHeroCenter} pointerEvents="none">
                <Text style={[styles.heroValue, { color: '#007AFF', textShadowColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)', textShadowRadius: 12 }]}>{value} mi</Text>
            </View>

            {/* Slider at bottom */}
            <View style={[styles.radiusControls, { bottom: insets.bottom + 100 }]}>
                <GlassView
                    effect="regular"
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
                        minimumTrackTintColor="#007AFF"
                        maximumTrackTintColor={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}
                        thumbTintColor="#007AFF"
                    />
                </GlassView>
            </View>
        </View>
    );
}

function OctaneStep({ isDark, themeColors, insets, value, onChange }) {
    return (
        <View style={[styles.stepContainer, { backgroundColor: themeColors.background }]}>

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
                                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                                    key={isDark ? `oct-dark-${option.key}` : `oct-light-${option.key}`}
                                    style={[
                                        styles.octaneCard,
                                        isSelected && { backgroundColor: isDark ? 'rgba(0,122,255,0.2)' : 'rgba(0,122,255,0.1)' },
                                    ]}
                                >
                                    <Text style={[styles.octaneNumber, { color: isSelected ? '#007AFF' : themeColors.text }]}>
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
        <View style={[styles.stepContainer, { backgroundColor: themeColors.background }]}>

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
                                tintColor={isDark ? '#000000' : '#FFFFFF'}
                                style={[
                                    styles.segmentButton,
                                    r === value && { backgroundColor: isDark ? 'rgba(255,184,0,0.2)' : 'rgba(255,184,0,0.1)' },
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
    const highlights = [
        { icon: 'location.magnifyingglass', text: 'Automatically find stations around you' },
        { icon: 'shield.checkered', text: 'Your data will never be shared with anyone else' },
        { icon: 'sparkles', text: 'Predictive Fueling needs Always Allow to predict when and where you fuel' },
        { icon: 'cpu', text: 'We don\'t have servers, everything happens on your device' },
    ];

    return (
        <View style={[styles.stepContainer, { backgroundColor: themeColors.background }]}>

            <View style={[styles.stepHeader, { paddingTop: insets.top + 40 }]}>
                <SymbolView name="location.fill" size={44} tintColor="#007AFF" />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Enable Location</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    To find the absolute cheapest gas, we need to know where you are.
                </Text>
            </View>

            <View style={[styles.stepContent, { justifyContent: 'flex-start', marginTop: 32 }]}>
                <View style={styles.locationHighlightsContainer}>
                    {highlights.map((item, index) => (
                        <View key={index} style={styles.locationHighlightItem}>
                            <View style={[styles.locationHighlightIconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                <SymbolView name={item.icon} size={24} tintColor="#007AFF" />
                            </View>
                            <Text style={[styles.locationHighlightText, { color: themeColors.text }]}>
                                {item.text}
                            </Text>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}

function NotificationStep({ isDark, themeColors, insets, permissionStatus }) {
    const highlights = [
        { icon: 'bell.slash.fill', text: 'We will rarely send you notifications' },
        { icon: 'hourglass.bottomhalf.filled', text: 'Live Activities for your Dynamic Island, Lock Screen, and CarPlay' },
        { icon: 'exclamationmark.shield.fill', text: 'Alerts when you\'re about to get a bad deal at a gas station' },
    ];

    return (
        <View style={[styles.stepContainer, { backgroundColor: themeColors.background }]}>

            <View style={[styles.stepHeader, { paddingTop: insets.top + 40 }]}>
                <SymbolView name="bell.badge.fill" size={44} tintColor="#FF3B30" />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Allow Live Activities</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    We'll identify when you're about to get a bad deal, and we'll redirect you in real time.
                </Text>
            </View>

            <View style={[styles.stepContent, { gap: 40, justifyContent: 'flex-start', marginTop: 32 }]}>
                <View style={styles.mockLiveActivityContainer}>
                    <GlassView
                        effect="regular"
                        tintColor="#000000"
                        style={styles.mockLiveActivityGlass}
                    >
                        <View style={styles.mockLiveActivityHeader}>
                            <View style={styles.mockLiveActivityAppIcon}>
                                <Image
                                    source={require('../../assets/predictive-fueling.png')}
                                    style={{ width: 22, height: 22, borderRadius: 5 }}
                                    resizeMode="contain"
                                />
                            </View>
                            <Text style={[styles.mockLiveActivityTitle, { color: '#FFFFFF' }]}>Predictive Fueling</Text>
                            <Text style={[styles.mockLiveActivityTime, { color: '#FFFFFF', opacity: 0.5 }]}>now</Text>
                        </View>

                        <View style={styles.mockLiveActivityContent}>
                            <View style={styles.mockLiveActivityMain}>
                                <View style={styles.mockLiveActivityStationInfo}>
                                    <Text style={[styles.mockLiveActivityStationName, { color: '#FFFFFF' }]}>Save $12.92 at Mobil One</Text>
                                    <View style={styles.mockLiveActivityBadge}>
                                        <Text style={styles.mockLiveActivityBadgeText}>on the way</Text>
                                    </View>
                                </View>
                                <View style={styles.mockLiveActivityPriceContainer}>
                                    <Text style={[styles.mockLiveActivityPriceLabel, { color: '#FFFFFF', opacity: 0.6 }]}>Regular</Text>
                                    <Text style={[styles.mockLiveActivityPrice, { color: '#00cb36ff' }]}>$2.62</Text>
                                </View>
                            </View>

                            <View style={[styles.mockLiveActivityDivider, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />

                            <View style={styles.mockLiveActivityFooter}>
                                <SymbolView name="location.fill" size={12} tintColor="#FFFFFF" style={{ opacity: 0.6 }} />
                                <Text style={[styles.mockLiveActivityDistance, { color: '#FFFFFF', opacity: 0.6 }]}>0.4 mi away • Take Next Left</Text>
                            </View>
                        </View>
                    </GlassView>
                </View>

                <View style={[styles.locationHighlightsContainer, { paddingBottom: 0 }]}>
                    {highlights.map((item, index) => (
                        <View key={index} style={styles.locationHighlightItem}>
                            <View style={[styles.locationHighlightIconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                <SymbolView name={item.icon} size={24} tintColor="#FF3B30" />
                            </View>
                            <Text style={[styles.locationHighlightText, { color: themeColors.text }]}>
                                {item.text}
                            </Text>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}

const videoSource = require('../../assets/red_car_drives.mp4');

function PredictiveFuelingStep({ isDark, themeColors, insets, player, isActive }) {
    const greenPos = { top: 28, left: 75 };
    const redPos = { top: 15, left: 2 };

    // --- Animation Trigger Points (in seconds) ---
    // Easily configure when you want the 3 steps to animate in during the video playback
    const redChipTriggerPoint = 0.7;
    const liveActivityTriggerPoint = 1.8;
    const greenChipTriggerPoint = 3.0;

    const [showRed, setShowRed] = useState(false);
    const [showLive, setShowLive] = useState(false);
    const [showGreen, setShowGreen] = useState(false);

    useEffect(() => {
        if (isActive) {
            player.currentTime = 0.0;
            player.play();
        } else {
            player.pause();
        }
    }, [isActive, player]);


    useEffect(() => {
        if (!isActive) return;

        // Check video time periodically to trigger animations
        const interval = setInterval(() => {
            const t = player.currentTime;
            // Only set to true once the time is reached. They will remain true 
            // even if the video loops, preventing them from disappearing.
            setShowRed(prev => prev || t >= redChipTriggerPoint);

            setShowLive(prev => {
                if (!prev && t >= liveActivityTriggerPoint) {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    return true;
                }
                return prev;
            });

            setShowGreen(prev => prev || t >= greenChipTriggerPoint);
        }, 50);

        return () => clearInterval(interval);
    }, [isActive, player]);




    return (
        <View style={[styles.stepContainer, { backgroundColor: themeColors.background }]}>

            <View style={[styles.stepHeader, { paddingTop: insets.top + 40 }]}>
                <Image
                    source={require('../../assets/predictive-fueling.png')}
                    style={{ width: 80, height: 80, borderRadius: 20 }}
                    resizeMode="contain"
                />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Predictive Fueling</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    We'll predict your gas stop and find a cheaper station on your way.
                </Text>
            </View>

            <View style={[styles.stepContent, { paddingHorizontal: 0, justifyContent: 'flex-start', marginTop: 24 }]}>
                <View style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.6 }}>
                    <VideoView
                        player={player}
                        style={StyleSheet.absoluteFill}
                        nativeControls={false}
                        contentFit="cover"
                    />
                    {showGreen && (
                        <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none" entering={FadeIn.duration(800)}>
                            <OnboardingChip
                                price={3.89}
                                isCheapest={true}
                                isDark={isDark}
                                top={greenPos.top}
                                left={greenPos.left}
                                isActive={isActive}
                            />

                        </Animated.View>
                    )}

                    {showRed && (
                        <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none" entering={FadeIn.duration(800)}>
                            <OnboardingChip
                                price={4.59}
                                isCheapest={false}
                                isDark={isDark}
                                top={redPos.top}
                                left={redPos.left}
                                isActive={isActive}
                            />

                        </Animated.View>
                    )}
                </View>

                {/* Mock Live Activity */}
                <View style={[styles.mockLiveActivityContainer, { marginTop: 0 }]}>
                    {showLive && (
                        <Animated.View
                            entering={FadeInUp.springify().mass(1).damping(16).stiffness(120)}
                            style={{ width: '100%', alignItems: 'center' }}
                        >
                            <GlassView
                                effect="regular"
                                tintColor="#000000"
                                style={styles.mockLiveActivityGlass}
                                key={isActive ? 'glass-active' : 'glass-inactive'}
                            >

                                <View style={styles.mockLiveActivityHeader}>
                                    <View style={styles.mockLiveActivityAppIcon}>
                                        <Image
                                            source={require('../../assets/predictive-fueling.png')}
                                            style={{ width: 22, height: 22, borderRadius: 5 }}
                                            resizeMode="contain"
                                        />
                                    </View>
                                    <Text style={[styles.mockLiveActivityTitle, { color: '#FFFFFF' }]}>Fuel Up</Text>
                                    <Text style={[styles.mockLiveActivityTime, { color: '#FFFFFF', opacity: 0.5 }]}>now</Text>
                                </View>

                                <View style={styles.mockLiveActivityContent}>
                                    <View style={styles.mockLiveActivityMain}>
                                        <View style={styles.mockLiveActivityStationInfo}>
                                            <Text style={[styles.mockLiveActivityStationName, { color: '#FFFFFF' }]}>Save $8.93 at Mobil One</Text>
                                            <View style={styles.mockLiveActivityBadge}>
                                                <Text style={styles.mockLiveActivityBadgeText}>Cheapest</Text>
                                            </View>
                                        </View>
                                        <View style={styles.mockLiveActivityPriceContainer}>
                                            <Text style={[styles.mockLiveActivityPriceLabel, { color: '#FFFFFF', opacity: 0.6 }]}>Regular</Text>
                                            <Text style={[styles.mockLiveActivityPrice, { color: '#007AFF' }]}>$3.89</Text>
                                        </View>
                                    </View>

                                    <View style={[styles.mockLiveActivityDivider, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />

                                    <View style={styles.mockLiveActivityFooter}>
                                        <SymbolView name="location.fill" size={12} tintColor="#FFFFFF" style={{ opacity: 0.6 }} />
                                        <Text style={[styles.mockLiveActivityDistance, { color: '#FFFFFF', opacity: 0.6 }]}>1.2 mi away • On your route</Text>
                                    </View>
                                </View>
                            </GlassView>
                            <Animated.View entering={FadeIn.delay(300).duration(800)}>
                                <Text style={[styles.mockLiveActivityHint, { color: themeColors.text }]}>
                                    Get real-time alerts as you drive
                                </Text>
                            </Animated.View>
                        </Animated.View>
                    )}
                </View>
            </View>
        </View>
    );
}

function AnimatedButtonContent({ text, icon, isDark }) {
    const [currentText, setCurrentText] = useState(text);
    const [currentIcon, setCurrentIcon] = useState(icon);
    const opacity = useSharedValue(1);
    const scale = useSharedValue(1);

    useEffect(() => {
        if (text !== currentText || icon !== currentIcon) {
            // Smoothly transit via scale and opacity
            scale.value = withTiming(0.95, { duration: 150 });
            opacity.value = withTiming(0, { duration: 150 }, () => {
                runOnJS(setCurrentText)(text);
                runOnJS(setCurrentIcon)(icon);
                opacity.value = withTiming(1, { duration: 250 });
                scale.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.back()) });
            });
        }
    }, [text, icon, currentText, currentIcon]);

    const animatedContentStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }]
    }));

    return (
        <View style={styles.continueButtonInnerWrapper}>
            <Animated.View style={[styles.continueButtonInner, animatedContentStyle]}>
                <Text style={styles.continueText}>{currentText}</Text>
                <SymbolView
                    name={currentIcon}
                    size={18}
                    tintColor="#FFFFFF"
                />
            </Animated.View>
        </View>
    );
}

export default function OnboardingScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { preferences, updatePreference, completeOnboarding } = usePreferences();
    const [currentStep, setCurrentStep] = useState(0);

    const blurIntensity = useSharedValue(80);

    const animatedBlurProps = useAnimatedProps(() => ({
        intensity: blurIntensity.value,
    }));

    const animatedBlurStyle = useAnimatedStyle(() => ({
        opacity: blurIntensity.value > 0.1 ? 1 : 0,
        pointerEvents: blurIntensity.value > 10 ? 'auto' : 'none',
    }));

    useEffect(() => {
        // Initial splash unblur (defocus)
        blurIntensity.value = withDelay(500, withTiming(0, {
            duration: 1000,
            easing: Easing.out(Easing.exp)
        }));
    }, []);

    const predictivePlayer = useVideoPlayer(videoSource, (player) => {
        player.loop = true;
        player.muted = true;
        player.currentTime = 0.0;
    });
    const scrollViewRef = useRef(null);

    const handleScroll = (event) => {
        const offset = event.nativeEvent.contentOffset.x;
        const index = Math.round(offset / SCREEN_WIDTH);
        if (index !== currentStep && index >= 0 && index < totalSteps) {
            setCurrentStep(index);
        }
    };


    const totalSteps = 7;

    const [radius, setRadius] = useState(preferences.searchRadiusMiles);
    const [octane, setOctane] = useState(preferences.preferredOctane);
    const [minRating, setMinRating] = useState(preferences.minimumRating);
    const [permissionStatus, setPermissionStatus] = useState(null);
    const [notifPermissionStatus, setNotifPermissionStatus] = useState(null);

    const handleRequestPermission = async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setPermissionStatus(status);
        if (status === 'granted') {
            setTimeout(() => {
                scrollViewRef.current?.scrollTo({ x: (currentStep + 1) * SCREEN_WIDTH, animated: true });
            }, 600);
        }
    };


    const handleRequestNotifications = async () => {
        const token = await registerForPushNotificationsAsync();
        if (token) {
            setNotifPermissionStatus('granted');
            savePushTokenToSupabase(token); // Fire and forget
        } else {
            setNotifPermissionStatus('denied');
        }
        setTimeout(() => {
            scrollViewRef.current?.scrollTo({ x: (currentStep + 1) * SCREEN_WIDTH, animated: true });
        }, 600);
    };


    const handleContinue = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (currentStep === 2 && permissionStatus !== 'granted') {
            handleRequestPermission();
            return;
        }

        if (currentStep === 3 && notifPermissionStatus !== 'granted') {
            handleRequestNotifications();
            return;
        }

        if (currentStep < totalSteps - 1) {
            // Save preferences as we go
            if (currentStep === 4) updatePreference('searchRadiusMiles', radius);
            if (currentStep === 5) updatePreference('preferredOctane', octane);
            if (currentStep === 6) updatePreference('minimumRating', minRating);

            scrollViewRef.current?.scrollTo({ x: (currentStep + 1) * SCREEN_WIDTH, animated: true });
        } else {
            // Final step
            completeOnboarding();
        }
    };


    const isLastStep = currentStep === totalSteps - 1;

    // Use full map for specific steps
    const isTranslucentStep = currentStep === 0 || currentStep === 4;


    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>

            <View style={styles.content}>
                <ScrollView
                    ref={scrollViewRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={handleScroll}
                    scrollEventThrottle={16}
                    style={styles.scrollView}
                    removeClippedSubviews={false}
                >

                    <WelcomeStep isDark={isDark} themeColors={themeColors} insets={insets} />

                    <PredictiveFuelingStep
                        isDark={isDark}
                        themeColors={themeColors}
                        insets={insets}
                        player={predictivePlayer}
                        isActive={currentStep === 1}
                    />


                    <LocationStep isDark={isDark} themeColors={themeColors} insets={insets} permissionStatus={permissionStatus} />
                    <NotificationStep isDark={isDark} themeColors={themeColors} insets={insets} permissionStatus={notifPermissionStatus} />
                    <RadiusStep isDark={isDark} themeColors={themeColors} insets={insets} value={radius} onChange={setRadius} />
                    <OctaneStep isDark={isDark} themeColors={themeColors} insets={insets} value={octane} onChange={setOctane} />
                    <RatingStep isDark={isDark} themeColors={themeColors} insets={insets} value={minRating} onChange={setMinRating} />
                </ScrollView>
            </View>


            {/* Progress dots + continue (Stay solid) */}
            {isTranslucentStep && (
                <LinearGradient
                    colors={[isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0, isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85, isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND]}
                    locations={[0, 0.4, 1]}
                    style={[styles.footerGradient, { paddingBottom: insets.bottom + 20 }]}
                    pointerEvents="none"
                />
            )}

            <View style={[styles.footer, isTranslucentStep && styles.footerAbsolute, { paddingBottom: insets.bottom + 20 }]}>
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

                <Pressable onPress={handleContinue} style={styles.continueButton}>
                    <GlassView
                        effect="regular"
                        tintColor="#007AFF"
                        interactive
                        style={styles.continueGlass}
                    >
                        <AnimatedButtonContent
                            text={isLastStep ? 'Get Started' : (
                                currentStep === 2 && permissionStatus !== 'granted' ? 'Enable Location' :
                                    currentStep === 3 && notifPermissionStatus !== 'granted' ? 'Enable Notifications' : 'Continue'
                            )}
                            icon={isLastStep ? 'checkmark' : (
                                currentStep === 2 && permissionStatus !== 'granted' ? 'location.fill' :
                                    currentStep === 3 && notifPermissionStatus !== 'granted' ? 'bell.fill' : 'arrow.right'
                            )}
                            isDark={isDark}
                        />
                    </GlassView>
                </Pressable>
            </View>

            {/* Full-screen transition blur overlay (Dynamic Intensity) */}
            <Animated.View
                style={[StyleSheet.absoluteFill, animatedBlurStyle]}
                pointerEvents="none"
            >
                <AnimatedBlurView
                    animatedProps={animatedBlurProps}
                    tint={isDark ? 'dark' : 'light'}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    stepContainer: {
        width: SCREEN_WIDTH,
        flex: 1,
        backgroundColor: 'transparent', // Default to transparent as children will provide it or parent will
    },


    stepHeader: {
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 24,
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
        fontFamily: 'ui-rounded',
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
        paddingHorizontal: 24,
    },

    appIconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
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
        overflow: 'hidden',
    },
    demoChipCheapest: {
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
        fontFamily: 'ui-rounded',
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
    locationHighlightsContainer: {
        width: '100%',
        gap: 20,
    },
    locationHighlightItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 12,
    },
    locationHighlightIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    locationHighlightText: {
        fontSize: 16,
        fontWeight: '500',
        flex: 1,
        lineHeight: 22,
    },
    grantedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(0, 122, 255, 0.1)',
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
        paddingVertical: 18,
        borderRadius: 20,
        overflow: 'hidden',
    },
    continueButtonInnerWrapper: {
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    continueButtonInner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    continueText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
    },
    // Mock Live Activity
    mockLiveActivityContainer: {
        width: SCREEN_WIDTH - 48,
        alignItems: 'center',
    },
    mockLiveActivityGlass: {
        width: '100%',
        borderRadius: 24,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 200,
    },
    mockLiveActivityHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    mockLiveActivityAppIcon: {
        marginRight: 8,
    },
    mockLiveActivityTitle: {
        fontSize: 13,
        fontWeight: '600',
        flex: 1,
    },
    mockLiveActivityTime: {
        fontSize: 12,
    },
    mockLiveActivityContent: {
        gap: 12,
    },
    mockLiveActivityMain: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    mockLiveActivityStationInfo: {
        gap: 4,
    },
    mockLiveActivityStationName: {
        fontSize: 18,
        fontWeight: '700',
        fontFamily: 'ui-rounded',
    },
    mockLiveActivityBadge: {
        backgroundColor: 'rgba(0, 255, 47, 0.15)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        alignSelf: 'flex-start',
    },
    mockLiveActivityBadgeText: {
        color: '#00C838',
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    mockLiveActivityPriceContainer: {
        alignItems: 'flex-end',
    },
    mockLiveActivityPriceLabel: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
    },
    mockLiveActivityPrice: {
        fontSize: 24,
        fontWeight: '800',
        fontFamily: 'ui-rounded',
    },
    mockLiveActivityDivider: {
        height: 1,
        width: '100%',
    },
    mockLiveActivityFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    mockLiveActivityDistance: {
        fontSize: 13,
        fontWeight: '500',
    },
    mockLiveActivityHint: {
        marginTop: 12,
        fontSize: 13,
        fontWeight: '600',
        opacity: 0.4,
    },
});
