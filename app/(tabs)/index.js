import React, { startTransition, useEffect, useRef, useState, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import {
    LiquidGlassView,
    LiquidGlassContainerView,
    isLiquidGlassSupported
} from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';
import { GlassView } from 'expo-glass-effect';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_APPLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../../src/AppStateContext';
import FuelSummaryCard from '../../src/components/FuelSummaryCard';
import TopCanopy from '../../src/components/TopCanopy';
import { getCachedFuelPriceSnapshot, getFuelFailureMessage, refreshFuelPriceSnapshot } from '../../src/services/fuel';
import { useTheme } from '../../src/ThemeContext';
import { usePreferences } from '../../src/PreferencesContext';
import BottomCanopy from '../../src/components/BottomCanopy';
import Animated, {
    useSharedValue,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useAnimatedProps,
    interpolate,
    Extrapolate,
    interpolateColor,
    FadeIn,
    FadeOut,
    ZoomIn,
    ZoomOut,
    withTiming
} from 'react-native-reanimated';

const AnimatedLiquidGlassView = Animated.createAnimatedComponent(LiquidGlassView);
const AnimatedLiquidGlassContainer = Animated.createAnimatedComponent(LiquidGlassContainerView);

const DEFAULT_REGION = {
    latitude: 37.3346,
    longitude: -122.009,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
};
const TAB_BAR_CLEARANCE = 34;
const CARD_GAP = 0;
const SIDE_MARGIN = 16;
const TOP_CANOPY_HEIGHT = 72;

function AnimatedMarkerOverlay({ cluster, scrollX, itemWidth, isDark, themeColors, activeIndex, onMarkerPress, mapRegion }) {
    const { quotes, averageLat, averageLng } = cluster;

    // A cluster is considered active if any of its station indices matches the activeIndex
    const isActive = quotes.some(q => q.originalIndex === activeIndex);
    const isCheapestAcrossAll = quotes.some(q => q.originalIndex === 0);

    const animatedOverlayStyle = useAnimatedStyle(() => {
        return {};
    });

    const animatedTextStyle = useAnimatedStyle(() => {
        if (isCheapestAcrossAll) return { color: '#007AFF' };
        const baseIndex = quotes[0].originalIndex;
        const inputRange = [(baseIndex - 1) * itemWidth, baseIndex * itemWidth, (baseIndex + 1) * itemWidth];
        const color = interpolateColor(
            scrollX.value,
            inputRange,
            ['#888888', themeColors.text, '#888888']
        );
        return { color };
    });

    // Determine what to render inside the chip
    const primaryQuote = quotes[0];
    const isMultiQuote = quotes.length > 1;

    // Content fade-in animation
    const mountAnim = useSharedValue(0);
    // Animate relative bubble positions for "merging" effect
    const spreadAnim = useSharedValue(1);

    const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

    const threshold = mapRegion?.longitudeDelta ? mapRegion.longitudeDelta * 0.16 : 0;
    const lngs = quotes.map(q => q.longitude);
    const lats = quotes.map(q => q.latitude);
    const lngSpread = Math.max(...lngs) - Math.min(...lngs);
    const latSpread = Math.max(...lats) - Math.min(...lats);

    const ptPerLng = mapRegion?.longitudeDelta ? SCREEN_WIDTH / mapRegion.longitudeDelta : 0;
    const ptPerLat = mapRegion?.latitudeDelta ? SCREEN_HEIGHT / mapRegion.latitudeDelta : 0;

    const primaryLat = lats[0];
    const primaryLng = lngs[0];

    const restAvgLat = isMultiQuote ? lats.slice(1).reduce((sum, val) => sum + val, 0) / (lats.length - 1) : primaryLat;
    const restAvgLng = isMultiQuote ? lngs.slice(1).reduce((sum, val) => sum + val, 0) / (lngs.length - 1) : primaryLng;

    const offsets = {
        primaryDx: (primaryLng - averageLng) * ptPerLng,
        primaryDy: -(primaryLat - averageLat) * ptPerLat, // Invert Y because screen Y goes down
        restDx: (restAvgLng - averageLng) * ptPerLng,
        restDy: -(restAvgLat - averageLat) * ptPerLat,
    };

    // For the merge animation, we need to know if we JUST became multi-quote
    const prevIsMultiQuote = useRef(isMultiQuote);

    useEffect(() => {
        // Fade in content
        mountAnim.value = withTiming(1, { duration: 400 });
    }, []);

    useEffect(() => {
        if (!isMultiQuote || !mapRegion?.longitudeDelta) {
            spreadAnim.value = 0; // Snap instantly on split, no animation
            prevIsMultiQuote.current = isMultiQuote;
            return;
        }

        const latThreshold = mapRegion.latitudeDelta * 0.025;
        // The split threshold should maintain the exact physical distance as when merge was 0.12 (now 0.16)
        // Previous split was 0.12 * 1.5 = 0.18. Current merge is 0.16. 
        // 0.18 / 0.16 = 1.125
        const splitLngThreshold = threshold * 1.125;
        const splitLatThreshold = latThreshold * 1.125;

        // Animate up to the split boundary, not the merge boundary
        let ratioLng = splitLngThreshold > 0 ? lngSpread / splitLngThreshold : 0;
        let ratioLat = splitLatThreshold > 0 ? latSpread / splitLatThreshold : 0;
        let maxRatio = Math.max(ratioLng, ratioLat);

        // Constrain between 0 (perfectly merged) and 1 (ready to split)
        // Add a bit of non-linearity so they snap together quickly but pull away gradually
        let ratio = Math.max(0, Math.min(1, maxRatio));

        // They should act like a magnet. Mostly merged unless pulled quite far.
        // If ratio is < 0.3, they stay 0. If > 0.3 they start pulling away.
        let spread = 0;
        if (ratio > 0.4) {
            spread = (ratio - 0.4) / 0.6;
        }

        // If we just merged AND we are animating inward, snap to 1 so the animation pulls inward
        if (!prevIsMultiQuote.current && isMultiQuote) {
            spreadAnim.value = 1;
        }

        spreadAnim.value = withTiming(spread, { duration: 150 });
        prevIsMultiQuote.current = isMultiQuote;
    }, [mapRegion?.longitudeDelta, mapRegion?.latitudeDelta, isMultiQuote, lngSpread, latSpread, threshold]);

    const animatedContentStyle = useAnimatedStyle(() => {
        return {};
    });

    // Style for the primary price bubble
    const leftBubbleStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            zIndex: 2,
            transform: [
                { translateX: interpolate(spreadAnim.value, [0, 1], [isMultiQuote ? -22 : 0, offsets.primaryDx]) },
                { translateY: interpolate(spreadAnim.value, [0, 1], [0, offsets.primaryDy]) }
            ]
        };
    });

    // Style for the +N bubble
    const rightBubbleStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            zIndex: 1,
            justifyContent: 'center',
            // When merged (spread=0), keep it small and tight behind the main chip.
            // When separated (spread=1), it needs to be identical size/padding to the main chip.
            paddingHorizontal: interpolate(spreadAnim.value, [0.8, 0.95], [8, 10], Extrapolate.CLAMP),
            paddingVertical: interpolate(spreadAnim.value, [0, 0.5, 1], [6, 6, 6]), // ensure stability
            // Smoothly expand the width before cross-fading the text
            minWidth: interpolate(spreadAnim.value, [0.8, 0.95], [40, 72], Extrapolate.CLAMP),
            transform: [
                { translateX: interpolate(spreadAnim.value, [0, 1], [28, offsets.restDx]) },
                { translateY: interpolate(spreadAnim.value, [0, 1], [0, offsets.restDy]) }
            ]
        };
    });

    // Cross-fade styles for the text morphing
    const plusNStyle = useAnimatedStyle(() => {
        return {
            // Fade out the "+N" as it stretches away
            opacity: interpolate(spreadAnim.value, [0.85, 0.95], [1, 0], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(spreadAnim.value, [0.85, 0.95], [1, 0.5], Extrapolate.CLAMP) }]
        }
    });

    const escapingPriceStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            // Fade in the real price as it stretches away
            opacity: interpolate(spreadAnim.value, [0.9, 1], [0, 1], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(spreadAnim.value, [0.9, 1], [0.8, 1], Extrapolate.CLAMP) }]
        }
    });

    // The station that will physically emerge from the cluster
    const emergingQuote = isMultiQuote ? quotes[1] : null;

    return (
        <Marker
            key={quotes[0].stationId} // Ensure key is bound to primary station so it doesn't unmount
            coordinate={{
                latitude: averageLat,
                longitude: averageLng,
            }}
            anchor={{ x: 0.5, y: 0.5 }} // Keep anchor visually centered
            onPress={() => onMarkerPress(cluster)}
            style={{ zIndex: isActive ? 3 : isCheapestAcrossAll ? 2 : 1 }}
            tracksViewChanges={true}
        >
            <AnimatedLiquidGlassContainer
                spacing={24}
                style={[
                    styles.clusterContainer,
                    animatedOverlayStyle,
                    { minWidth: 160, minHeight: 70, justifyContent: 'center', alignItems: 'center' }
                ]}
            >
                {/* Main bubble with price (Front) */}
                <AnimatedLiquidGlassView
                    effect="clear"
                    style={[
                        styles.bubbleBase,
                        leftBubbleStyle,
                    ]}
                >
                    <Animated.View style={[styles.rowItem, animatedContentStyle]}>
                        <SymbolView
                            name="fuelpump.fill"
                            size={14}
                            tintColor={primaryQuote.originalIndex === 0 ? '#007AFF' : (primaryQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                            style={styles.priceIcon}
                        />
                        <Animated.Text
                            style={[
                                styles.priceText,
                                primaryQuote.originalIndex === 0 && styles.bestPriceText,
                                animatedTextStyle,
                            ]}
                        >
                            ${primaryQuote.price.toFixed(2)}
                        </Animated.Text>
                    </Animated.View>
                </AnimatedLiquidGlassView>

                {/* Secondary merging bubble for clusters (Behind) */}
                {isMultiQuote && (
                    <AnimatedLiquidGlassView
                        effect="clear"
                        style={[
                            styles.bubbleBase,
                            rightBubbleStyle,
                        ]}
                    >
                        <Animated.View style={[styles.rowItem, animatedContentStyle, plusNStyle, { justifyContent: 'center' }]}>
                            <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
                            <Animated.Text
                                style={[
                                    styles.priceText,
                                    animatedTextStyle,
                                ]}
                            >
                                +{quotes.length - 1}
                            </Animated.Text>
                        </Animated.View>

                        {/* The price it morphs into */}
                        {emergingQuote && (
                            <Animated.View style={[styles.rowItem, escapingPriceStyle, { justifyContent: 'center', width: '100%' }]}>
                                <SymbolView
                                    name="fuelpump.fill"
                                    size={14}
                                    tintColor={emergingQuote.originalIndex === 0 ? '#007AFF' : (emergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                    style={styles.priceIcon}
                                />
                                <Animated.Text
                                    style={[
                                        styles.priceText,
                                        emergingQuote.originalIndex === 0 && styles.bestPriceText,
                                        animatedTextStyle,
                                    ]}
                                >
                                    ${emergingQuote.price.toFixed(2)}
                                </Animated.Text>
                            </Animated.View>
                        )}
                    </AnimatedLiquidGlassView>
                )}
            </AnimatedLiquidGlassContainer>
        </Marker>
    );
}

function AnimatedCardItem({ item, index, scrollX, itemWidth, isDark, benchmarkQuote, errorMsg, isRefreshing, themeColors }) {
    const animatedDimStyle = useAnimatedStyle(() => {
        if (isDark) return { opacity: 0 };

        const inputRange = [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth];
        const dimOpacity = interpolate(
            scrollX.value,
            inputRange,
            [0.3, 0, 0.3],
            Extrapolate.CLAMP
        );

        return { opacity: dimOpacity };
    });

    return (
        <View style={{ width: itemWidth, paddingHorizontal: 4 }}>
            <FuelSummaryCard
                benchmarkQuote={benchmarkQuote}
                errorMsg={errorMsg}
                isDark={isDark}
                isRefreshing={isRefreshing}
                quote={item}
                themeColors={themeColors}
                rank={index + 1}
            />
            {!isDark && (
                <Animated.View
                    pointerEvents="none"
                    style={[{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 4,
                        right: 4,
                        backgroundColor: '#000000',
                        borderRadius: 32
                    }, animatedDimStyle]}
                />
            )}
        </View>
    );
}

export default function HomeScreen() {
    const mapRef = useRef(null);
    const flatListRef = useRef(null);
    const isMountedRef = useRef(true);
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { preferences } = usePreferences();
    const { fuelResetToken, manualLocationOverride, setFuelDebugState } = useAppState();
    const [location, setLocation] = useState(DEFAULT_REGION);
    const [bestQuote, setBestQuote] = useState(null);
    const [topStations, setTopStations] = useState([]);
    const [regionalQuotes, setRegionalQuotes] = useState([]);
    const [errorMsg, setErrorMsg] = useState(null);
    const [isLoadingLocation, setIsLoadingLocation] = useState(true);
    const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
    const [hasLocationPermission, setHasLocationPermission] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
    const router = useRouter();
    const scrollX = useSharedValue(0);

    const USE_SHEET_UX = false; // Temporary toggle for the Form Sheet UX experiment

    const bottomPadding = insets.bottom + TAB_BAR_CLEARANCE + CARD_GAP;
    const horizontalPadding = {
        left: insets.left + SIDE_MARGIN,
        right: insets.right + SIDE_MARGIN,
    };
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const canopyEdgeLine = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.42)';

    const applySnapshot = snapshot => {
        if (!snapshot?.quote || !isMountedRef.current) {
            return;
        }

        startTransition(() => {
            setBestQuote(snapshot.quote);
            setTopStations(snapshot.topStations || []);
            setRegionalQuotes(snapshot.regionalQuotes || []);
        });
    };

    const clearVisibleFuelState = (nextError = null) => {
        startTransition(() => {
            setBestQuote(null);
            setTopStations([]);
            setRegionalQuotes([]);
        });
        setErrorMsg(nextError);
        setIsRefreshingPrices(false);
        setIsLoadingLocation(false);
    };

    const resolveCurrentLocation = async () => {
        if (manualLocationOverride) {
            const manualLatitude = Number(manualLocationOverride.latitude);
            const manualLongitude = Number(manualLocationOverride.longitude);
            const isManualLocationValid =
                Number.isFinite(manualLatitude) &&
                Number.isFinite(manualLongitude) &&
                manualLatitude >= -90 &&
                manualLatitude <= 90 &&
                manualLongitude >= -180 &&
                manualLongitude <= 180;

            if (!isManualLocationValid) {
                if (isMountedRef.current) {
                    const invalidLocationMessage = getFuelFailureMessage({
                        reason: 'invalid-manual-location',
                    });

                    setFuelDebugState({
                        input: {
                            fuelType: 'regular',
                            latitude: manualLocationOverride.latitude,
                            longitude: manualLocationOverride.longitude,
                            locationSource: 'manual',
                            radiusMiles: 10,
                            zipCode: null,
                        },
                        providers: [],
                        requestedAt: new Date().toISOString(),
                    });
                    clearVisibleFuelState(invalidLocationMessage);
                }
                return null;
            }

            const manualRegion = {
                latitude: manualLatitude,
                longitude: manualLongitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };

            if (isMountedRef.current) {
                setHasLocationPermission(false);
                setLocation(manualRegion);
                mapRef.current?.animateToRegion(manualRegion, 550);
                setIsLoadingLocation(false);
            }

            return {
                ...manualRegion,
                locationSource: 'manual',
            };
        }

        if (!bestQuote) {
            setIsLoadingLocation(true);
        }

        try {
            const permissionState = await Location.getForegroundPermissionsAsync();
            let permissionStatus = permissionState.status;

            if (permissionStatus !== 'granted') {
                const requestedState = await Location.requestForegroundPermissionsAsync();
                permissionStatus = requestedState.status;
            }

            if (permissionStatus !== 'granted') {
                if (isMountedRef.current) {
                    setHasLocationPermission(false);
                    clearVisibleFuelState('Location permission was denied. Allow location to search for the cheapest nearby fuel.');
                }
                return null;
            }

            if (isMountedRef.current) {
                setHasLocationPermission(true);
            }

            const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });

            if (!isMountedRef.current) {
                return null;
            }

            const nextRegion = {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };

            setLocation(nextRegion);
            mapRef.current?.animateToRegion(nextRegion, 550);

            return nextRegion;
        } catch (error) {
            if (isMountedRef.current) {
                setHasLocationPermission(false);
                clearVisibleFuelState('Unable to get your current location. In the iOS Simulator, set a location in Features > Location.');
            }
            return null;
        } finally {
            if (isMountedRef.current) {
                setIsLoadingLocation(false);
            }
        }
    };

    const loadFuelData = async ({ latitude, longitude, locationSource, preferCached }) => {
        const query = {
            latitude,
            longitude,
            radiusMiles: preferences.searchRadiusMiles || 10,
            fuelType: preferences.preferredOctane || 'regular',
            preferredProvider: preferences.preferredProvider || 'gasbuddy',
        };
        const baseDebugState = {
            input: {
                ...query,
                locationSource,
                zipCode: null,
            },
            providers: [],
            requestedAt: new Date().toISOString(),
        };

        try {
            if (isMountedRef.current) {
                setFuelDebugState(baseDebugState);
            }

            if (preferCached) {
                const cachedSnapshot = await getCachedFuelPriceSnapshot(query);
                applySnapshot(cachedSnapshot);
            }

            if (isMountedRef.current) {
                setErrorMsg(null);
                setIsRefreshingPrices(true);
            }

            const result = await refreshFuelPriceSnapshot(query);
            const freshSnapshot = result?.snapshot;
            const nextDebugState = result?.debugState
                ? {
                    ...result.debugState,
                    input: {
                        ...result.debugState.input,
                        locationSource,
                    },
                }
                : baseDebugState;

            if (!freshSnapshot?.quote) {
                throw new Error('No prices returned');
            }

            applySnapshot(freshSnapshot);

            if (isMountedRef.current) {
                setErrorMsg(null);
                setFuelDebugState(nextDebugState);
            }
        } catch (error) {
            if (isMountedRef.current) {
                const nextDebugState = error?.debugState
                    ? {
                        ...error.debugState,
                        input: {
                            ...error.debugState.input,
                            locationSource,
                        },
                    }
                    : baseDebugState;

                setFuelDebugState(nextDebugState);
                clearVisibleFuelState(
                    error?.userMessage ||
                    getFuelFailureMessage({
                        debugState: nextDebugState,
                    })
                );
            }
        } finally {
            if (isMountedRef.current) {
                setIsRefreshingPrices(false);
            }
        }
    };

    const refreshForCurrentView = async ({ preferCached }) => {
        const nextRegion = await resolveCurrentLocation();

        if (!nextRegion) {
            return;
        }

        await loadFuelData({
            latitude: nextRegion.latitude,
            longitude: nextRegion.longitude,
            locationSource: nextRegion.locationSource || 'device',
            preferCached,
        });
    };

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!fuelResetToken) {
            return;
        }

        clearVisibleFuelState('Fuel cache cleared. Open Home to fetch fresh prices.');
        setFuelDebugState(null);
    }, [fuelResetToken]);

    useEffect(() => {
        if (!isFocused) {
            return;
        }

        void refreshForCurrentView({
            preferCached: true,
        });
    }, [isFocused, manualLocationOverride]);

    const onViewableItemsChanged = useRef(({ viewableItems }) => {
        if (viewableItems.length > 0) {
            setActiveIndex(viewableItems[0].index);
        }
    }).current;

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollX.value = event.contentOffset.x;
        },
    });

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 50,
    }).current;

    const minRating = preferences.minimumRating || 0;
    const stationQuotes = (topStations.length > 0 ? topStations : (bestQuote ? [bestQuote] : []))
        .filter(q => minRating === 0 || (q.rating != null && q.rating >= minRating))
        .map((q, idx) => ({ ...q, originalIndex: idx }));

    const previousClustersRef = useRef([]);

    const clusters = useMemo(() => {
        if (stationQuotes.length === 0) return [];

        const latDelta = mapRegion.latitudeDelta || 0.05;
        const lngDelta = mapRegion.longitudeDelta || 0.05;

        // Visual thresholds based on chip pixel dimensions
        const mergeLatHeight = latDelta * 0.040;
        const mergeLngWidth = lngDelta * 0.16;

        // Hysteresis: Keep absolute separation distance the same as before 
        // (prev was 0.030 * 1.5 = 0.045, 0.045 / 0.040 = 1.125)
        // (prev was 0.12 * 1.5 = 0.18, 0.18 / 0.16 = 1.125)
        const splitLatHeight = mergeLatHeight * 1.125;
        const splitLngWidth = mergeLngWidth * 1.125;

        const cheapestStation = stationQuotes[0];
        const others = stationQuotes.slice(1);

        const finalClusters = [];

        // 1. Cheapest station is always standalone
        finalClusters.push({
            quotes: [cheapestStation],
            averageLat: cheapestStation.latitude,
            averageLng: cheapestStation.longitude,
        });

        // 2. Group all other overlapping stations together
        others.forEach(quote => {
            let grouped = false;
            for (const cluster of finalClusters) {
                // Don't group with the absolute cheapest standalone station
                if (cluster.quotes[0].originalIndex === 0) continue;

                // Check if they were already grouped together in the previous frame
                const wasPreviouslyGrouped = previousClustersRef.current.some(prevCluster =>
                    prevCluster.quotes.some(q => q.stationId === quote.stationId) &&
                    prevCluster.quotes.some(q => q.stationId === cluster.quotes[0].stationId)
                );

                const latDiff = Math.abs(cluster.averageLat - quote.latitude);
                const lngDiff = Math.abs(cluster.averageLng - quote.longitude);

                // If within physical overlap bounds, swallow into cluster
                // Use the wider split threshold if they were already grouped, otherwise use the tighter merge threshold
                const currentLatThreshold = wasPreviouslyGrouped ? splitLatHeight : mergeLatHeight;
                const currentLngThreshold = wasPreviouslyGrouped ? splitLngWidth : mergeLngWidth;

                if (latDiff < currentLatThreshold && lngDiff < currentLngThreshold) {
                    cluster.quotes.push(quote);
                    // Dynamically update center of mass
                    cluster.averageLat = cluster.quotes.reduce((sum, q) => sum + q.latitude, 0) / cluster.quotes.length;
                    cluster.averageLng = cluster.quotes.reduce((sum, q) => sum + q.longitude, 0) / cluster.quotes.length;
                    grouped = true;
                    break;
                }
            }

            if (!grouped) {
                finalClusters.push({
                    quotes: [quote],
                    averageLat: quote.latitude,
                    averageLng: quote.longitude,
                });
            }
        });

        // Ensure quotes inside clusters are sorted by price ascending (just in case)
        finalClusters.forEach(cluster => {
            if (cluster.quotes.length > 1) {
                cluster.quotes.sort((a, b) => a.price - b.price);
            }
        });

        previousClustersRef.current = finalClusters;
        return finalClusters;
    }, [stationQuotes, mapRegion.latitudeDelta, mapRegion.longitudeDelta]);

    const handleMarkerPress = (cluster) => {
        const primaryQuote = cluster.quotes[0];
        const index = primaryQuote.originalIndex;

        isUserScrollingRef.current = false; // Prevent map feedback loop
        flatListRef.current?.scrollToOffset({
            offset: index * itemWidth,
            animated: true,
        });
        setActiveIndex(index);

        // If it's a cluster, zoom in to naturally separate them
        if (cluster.quotes.length > 1 && mapRef.current) {
            // Find the maximum spread of the cluster to determine how far to zoom in
            const lats = cluster.quotes.map(q => q.latitude);
            const lngs = cluster.quotes.map(q => q.longitude);

            const maxLat = Math.max(...lats);
            const minLat = Math.min(...lats);
            const maxLng = Math.max(...lngs);
            const minLng = Math.min(...lngs);

            const latSpread = maxLat - minLat;
            const lngSpread = maxLng - minLng;

            // Zoom out far enough so we can comfortably see all separated icons around the center
            // A multiplier of 5-6 ensures the cluster spread occupies only a fraction of the screen, safely unmerging them
            const targetLatDelta = Math.max(latSpread * 6, 0.03);
            const targetLngDelta = Math.max(lngSpread * 6, 0.03);

            isAnimatingRef.current = true;
            mapRef.current.animateToRegion({
                latitude: cluster.averageLat,
                longitude: cluster.averageLng,
                latitudeDelta: targetLatDelta,
                longitudeDelta: targetLngDelta,
            }, 600);
        }
    };

    const { width } = Dimensions.get('window');

    // We want the card to be almost full width, minus some padding to peek the next card.
    const peekPadding = 16;
    const itemWidth = width - (peekPadding * 2);
    const sideInset = (width - itemWidth) / 2;

    const lastDataHashRef = useRef('');
    const isUserScrollingRef = useRef(false);
    const isAnimatingRef = useRef(false);
    const prevIsFocusedRef = useRef(isFocused);

    useEffect(() => {
        const wasFocused = prevIsFocusedRef.current;
        prevIsFocusedRef.current = isFocused;

        if (!mapRef.current || stationQuotes.length === 0 || isAnimatingRef.current) return;

        // Use ONLY stationQuotes for the data hash to avoid feedback loops from zooming
        const currentHash = stationQuotes.map(q => q.stationId).join(',');
        const isFocusGained = isFocused && !wasFocused;
        const isNewData = currentHash !== lastDataHashRef.current;

        if (isNewData || isFocusGained) {
            lastDataHashRef.current = currentHash;
            isUserScrollingRef.current = false;

            // Frame all stations (since clusters are dynamic and zoom-dependent)
            const coords = [
                { latitude: location.latitude, longitude: location.longitude },
                ...stationQuotes.filter(q => q.latitude && q.longitude).map(q => ({ latitude: q.latitude, longitude: q.longitude }))
            ];

            if (coords.length > 1) {
                isAnimatingRef.current = true;
                setTimeout(() => {
                    mapRef.current?.fitToCoordinates(coords, {
                        edgePadding: { top: 120, right: 60, bottom: bottomPadding + 160, left: 60 },
                        animated: true,
                    });
                }, 100);
            }
        } else if (isUserScrollingRef.current && activeIndex >= 0 && activeIndex < stationQuotes.length) {
            const activeQuote = stationQuotes[activeIndex];
            if (activeQuote.latitude && activeQuote.longitude) {
                isAnimatingRef.current = true;
                mapRef.current.animateToRegion({
                    latitude: activeQuote.latitude,
                    longitude: activeQuote.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }, 400);
            }
        }
    }, [activeIndex, stationQuotes, location, bottomPadding, isFocused]);

    const fallbackCoordinate = {
        latitude: location.latitude,
        longitude: location.longitude,
    };
    const benchmarkQuote = regionalQuotes.find(quote => quote.providerId !== bestQuote?.providerId) || regionalQuotes[0] || null;

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                initialRegion={DEFAULT_REGION}
                provider={PROVIDER_APPLE}
                showsUserLocation={hasLocationPermission}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
                onRegionChange={(region) => {
                    if (!isAnimatingRef.current) {
                        setMapRegion(region);
                    }
                }}
                onRegionChangeComplete={(region) => {
                    setMapRegion(region);
                    isAnimatingRef.current = false;
                }}
            >
                {clusters.length > 0 ? (
                    clusters.map((cluster, index) => (
                        <AnimatedMarkerOverlay
                            key={cluster.quotes.map(q => q.stationId).join('-')}
                            cluster={cluster}
                            scrollX={scrollX}
                            itemWidth={itemWidth}
                            isDark={isDark}
                            themeColors={themeColors}
                            activeIndex={activeIndex}
                            onMarkerPress={handleMarkerPress}
                            mapRegion={mapRegion}
                        />
                    ))
                ) : (
                    <Marker
                        coordinate={fallbackCoordinate}
                        title="No Prices Returned"
                        description={
                            errorMsg
                                ? 'No live station price available'
                                : isLoadingLocation
                                    ? 'Finding your location'
                                    : 'Checking fuel providers'
                        }
                        pinColor="#D46A4C"
                    />
                )}
            </MapView>

            <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />
            <BottomCanopy height={bottomPadding + 140} isDark={isDark} />

            <View
                style={[
                    styles.reloadButtonShell,
                    {
                        top: insets.top + 6,
                        left: horizontalPadding.left,
                    },
                ]}
            >
                <Pressable
                    disabled={isRefreshingPrices || isLoadingLocation}
                    onPress={() =>
                        void refreshForCurrentView({
                            preferCached: false,
                        })
                    }
                >
                    <GlassView
                        style={[
                            styles.reloadButton,
                            isRefreshingPrices || isLoadingLocation ? styles.reloadButtonDisabled : null,
                        ]}
                        tintColor={isDark ? '#000000' : '#FFFFFF'}
                        glassEffectStyle="clear"
                        key={isDark ? 'reload-dark' : 'reload-light'}
                    >
                        <Ionicons color={themeColors.text} name="refresh" size={16} />
                        <Text style={[styles.reloadButtonText, { color: themeColors.text }]}>Reload</Text>
                    </GlassView>
                </Pressable>
            </View>

            <View
                pointerEvents="none"
                style={[
                    styles.topHeader,
                    {
                        paddingTop: insets.top + 10,
                        paddingLeft: horizontalPadding.left,
                        paddingRight: horizontalPadding.right,
                    },
                ]}
            >
                <Text style={[styles.headerTitle, { color: themeColors.text }]}>Fuel Up</Text>
            </View>

            <View
                style={[
                    styles.contentOverlay,
                    {
                        bottom: bottomPadding,
                        justifyContent: 'center',
                        alignItems: 'center',
                    },
                ]}
            >
                {USE_SHEET_UX ? (
                    <Pressable
                        onPress={() => {
                            router.push({
                                pathname: '/prices-sheet',
                                params: {
                                    quotesData: stationQuotes.length > 0 ? JSON.stringify(stationQuotes) : JSON.stringify([bestQuote].filter(Boolean)),
                                    benchmarkData: benchmarkQuote ? JSON.stringify(benchmarkQuote) : null,
                                    errorMsg: errorMsg || '',
                                },
                            });
                        }}
                        style={{ width: itemWidth }}
                    >
                        <GlassView
                            tintColor={isDark ? '#000000' : '#FFFFFF'}
                            glassEffectStyle="clear"
                            style={styles.sheetTriggerButton}
                        >
                            <Text style={[styles.sheetTriggerText, { color: themeColors.text }]}>
                                {stationQuotes.length > 0 ? `View ${stationQuotes.length} Nearby Stations` : 'View Gas Stations'}
                            </Text>
                            <Ionicons name="chevron-up" size={20} color={themeColors.text} />
                        </GlassView>
                    </Pressable>
                ) : stationQuotes.length > 0 ? (
                    <Animated.FlatList
                        ref={flatListRef}
                        data={stationQuotes}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        decelerationRate="fast"
                        keyExtractor={(item, index) => item.stationId || index.toString()}
                        contentContainerStyle={{
                            paddingHorizontal: sideInset,
                            alignItems: 'center', // Fix bottom padding mismatch 
                        }}
                        snapToInterval={itemWidth} // Precise snapping prevents jitter
                        snapToAlignment="start"
                        disableIntervalMomentum={true}
                        onViewableItemsChanged={onViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        onScrollBeginDrag={() => { isUserScrollingRef.current = true; }}
                        onScroll={scrollHandler}
                        scrollEventThrottle={16}
                        renderItem={({ item, index }) => (
                            <AnimatedCardItem
                                item={item}
                                index={index}
                                scrollX={scrollX}
                                itemWidth={itemWidth}
                                isDark={isDark}
                                benchmarkQuote={benchmarkQuote}
                                errorMsg={errorMsg}
                                isRefreshing={isRefreshingPrices || isLoadingLocation}
                                themeColors={themeColors}
                            />
                        )}
                    />
                ) : (
                    <View style={{ width: width, paddingHorizontal: sideInset }}>
                        <FuelSummaryCard
                            benchmarkQuote={benchmarkQuote}
                            errorMsg={errorMsg}
                            isDark={isDark}
                            isRefreshing={isRefreshingPrices || isLoadingLocation}
                            quote={bestQuote}
                            themeColors={themeColors}
                        />
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topHeader: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 10,
    },
    contentOverlay: {
        position: 'absolute',
        width: '100%',
        alignItems: 'center',
    },
    sheetTriggerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 24,
        gap: 8,
    },
    sheetTriggerText: {
        fontSize: 17,
        fontWeight: '700',
    },
    reloadButtonShell: {
        position: 'absolute',
        zIndex: 2,
    },
    reloadButton: {
        minHeight: 42,
        paddingHorizontal: 14,
        borderRadius: 21,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    reloadButtonDisabled: {
        opacity: 0.72,
    },
    reloadButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    priceOverlay: {
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
    clusterContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
    },
    bubbleBase: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
    },
    rowItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    priceText: {
        fontSize: 15,
        fontWeight: '700',
    },
    bestPriceText: {
        fontWeight: '900',
    },
    priceIcon: {
        marginRight: 2,
    },
});
