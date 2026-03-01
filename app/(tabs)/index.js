import React, { startTransition, useEffect, useRef, useState, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
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
    interpolate,
    Extrapolate,
    interpolateColor
} from 'react-native-reanimated';

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

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

function AnimatedMarkerOverlay({ quote, index, isCheapest, isActive, scrollX, itemWidth, isDark, themeColors }) {
    const animatedOverlayStyle = useAnimatedStyle(() => {
        const inputRange = [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth];

        const borderWidth = interpolate(
            scrollX.value,
            inputRange,
            [0, 2, 0],
            Extrapolate.CLAMP
        );

        const activeBorderColor = isCheapest ? '#007AFF' : (isDark ? '#FFFFFF' : '#000000');
        const borderColor = interpolateColor(
            scrollX.value,
            inputRange,
            ['transparent', activeBorderColor, 'transparent']
        );

        return {
            borderWidth,
            borderColor,
        };
    });

    const animatedTextStyle = useAnimatedStyle(() => {
        if (isCheapest) return { color: '#007AFF' };
        const inputRange = [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth];
        const color = interpolateColor(
            scrollX.value,
            inputRange,
            ['#888888', themeColors.text, '#888888']
        );
        return { color };
    });

    return (
        <Marker
            key={quote.stationId || index}
            coordinate={{
                latitude: quote.latitude,
                longitude: quote.longitude,
            }}
            style={{ zIndex: isActive ? 3 : isCheapest ? 2 : 1 }}
        >
            <AnimatedGlassView
                glassEffectStyle="clear"
                tintColor={isDark ? '#000000' : '#FFFFFF'}
                key={isDark ? `marker-dark-${index}` : `marker-light-${index}`}
                style={[
                    styles.priceOverlay,
                    animatedOverlayStyle,
                ]}
            >
                <SymbolView
                    name="fuelpump.fill"
                    size={14}
                    tintColor={isCheapest ? '#007AFF' : (isActive ? themeColors.text : '#888888')}
                    style={styles.priceIcon}
                />
                <Animated.Text
                    style={[
                        styles.priceText,
                        isCheapest && styles.bestPriceText,
                        animatedTextStyle,
                    ]}
                >
                    ${quote.price.toFixed(2)}
                </Animated.Text>
            </AnimatedGlassView>
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
    const top3Quotes = (topStations.length > 0 ? topStations : (bestQuote ? [bestQuote] : []))
        .filter(q => minRating === 0 || (q.rating != null && q.rating >= minRating));
    const { width } = Dimensions.get('window');

    // We want the card to be almost full width, minus some padding to peek the next card.
    const peekPadding = 16;
    const itemWidth = width - (peekPadding * 2);
    const sideInset = (width - itemWidth) / 2;

    const lastDataHashRef = useRef('');
    const isUserScrollingRef = useRef(false);
    const prevIsFocusedRef = useRef(isFocused);

    useEffect(() => {
        const wasFocused = prevIsFocusedRef.current;
        prevIsFocusedRef.current = isFocused;

        if (!mapRef.current || top3Quotes.length === 0) return;

        const currentHash = top3Quotes.map(q => q.stationId).join(',');
        const isFocusGained = isFocused && !wasFocused;
        const isNewData = currentHash !== lastDataHashRef.current;

        if (isNewData || isFocusGained) {
            lastDataHashRef.current = currentHash;
            isUserScrollingRef.current = false;

            const coords = [
                { latitude: location.latitude, longitude: location.longitude },
                ...top3Quotes
                    .filter(q => q.latitude && q.longitude)
                    .map(q => ({ latitude: q.latitude, longitude: q.longitude }))
            ];

            if (coords.length > 1) {
                setTimeout(() => {
                    mapRef.current?.fitToCoordinates(coords, {
                        edgePadding: { top: 120, right: 60, bottom: bottomPadding + 160, left: 60 },
                        animated: true,
                    });
                }, 100);
            }
        } else if (isUserScrollingRef.current && activeIndex >= 0 && activeIndex < top3Quotes.length) {
            const activeQuote = top3Quotes[activeIndex];
            if (activeQuote.latitude && activeQuote.longitude) {
                mapRef.current.animateToRegion({
                    latitude: activeQuote.latitude,
                    longitude: activeQuote.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }, 400);
            }
        }
    }, [activeIndex, top3Quotes, location, bottomPadding, isFocused]);

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
            >
                {top3Quotes.length > 0 ? (
                    top3Quotes.map((quote, index) => (
                        <AnimatedMarkerOverlay
                            key={quote.stationId || index}
                            quote={quote}
                            index={index}
                            isCheapest={index === 0}
                            isActive={index === activeIndex}
                            scrollX={scrollX}
                            itemWidth={itemWidth}
                            isDark={isDark}
                            themeColors={themeColors}
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
                                    quotesData: top3Quotes.length > 0 ? JSON.stringify(top3Quotes) : JSON.stringify([bestQuote].filter(Boolean)),
                                    benchmarkData: benchmarkQuote ? JSON.stringify(benchmarkQuote) : null,
                                    errorMsg: errorMsg || '',
                                },
                            });
                        }}
                        style={{ width: itemWidth }}
                    >
                        <GlassView
                            tintColor={isDark ? '#000000' : '#FFFFFF'}
                            glassEffectStyle="regular"
                            style={styles.sheetTriggerButton}
                        >
                            <Text style={[styles.sheetTriggerText, { color: themeColors.text }]}>
                                {top3Quotes.length > 0 ? `View Top ${top3Quotes.length} Stations` : 'View Gas Stations'}
                            </Text>
                            <Ionicons name="chevron-up" size={20} color={themeColors.text} />
                        </GlassView>
                    </Pressable>
                ) : top3Quotes.length > 0 ? (
                    <Animated.FlatList
                        data={top3Quotes}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        decelerationRate="fast"
                        keyExtractor={(item, index) => item.stationId || index.toString()}
                        contentContainerStyle={{
                            paddingHorizontal: sideInset,
                        }}
                        snapToOffsets={top3Quotes.map((_, i) => i * itemWidth)}
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
