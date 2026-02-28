import React, { startTransition, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_APPLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FuelSummaryCard from '../../src/components/FuelSummaryCard';
import TopCanopy from '../../src/components/TopCanopy';
import { getCachedFuelPriceSnapshot, refreshFuelPriceSnapshot } from '../../src/services/fuel';
import { useTheme } from '../../src/ThemeContext';

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

export default function HomeScreen() {
    const mapRef = useRef(null);
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const [location, setLocation] = useState(DEFAULT_REGION);
    const [bestQuote, setBestQuote] = useState(null);
    const [regionalQuotes, setRegionalQuotes] = useState([]);
    const [errorMsg, setErrorMsg] = useState(null);
    const [isLoadingLocation, setIsLoadingLocation] = useState(true);
    const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
    const [hasLocationPermission, setHasLocationPermission] = useState(false);
    const overlayBottom = insets.bottom + TAB_BAR_CLEARANCE + CARD_GAP;
    const horizontalPadding = {
        left: insets.left + SIDE_MARGIN,
        right: insets.right + SIDE_MARGIN,
    };
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const canopyEdgeLine = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.42)';

    useEffect(() => {
        let isMounted = true;

        const applySnapshot = snapshot => {
            if (!snapshot?.quote || !isMounted) {
                return;
            }

            startTransition(() => {
                setBestQuote(snapshot.quote);
                setRegionalQuotes(snapshot.regionalQuotes || []);
            });
        };

        const loadFuelData = async ({ latitude, longitude, zipCode }) => {
            const query = {
                latitude,
                longitude,
                zipCode,
                radiusMiles: 10,
                fuelType: 'regular',
            };
            let hadExistingQuote = false;

            try {
                const cachedSnapshot = await getCachedFuelPriceSnapshot(query);
                hadExistingQuote = Boolean(cachedSnapshot?.quote);

                applySnapshot(cachedSnapshot);

                if (isMounted) {
                    setIsRefreshingPrices(true);
                }

                const freshSnapshot = await refreshFuelPriceSnapshot(query);

                applySnapshot(freshSnapshot);
                if (isMounted) {
                    setErrorMsg(null);
                }
            } catch (error) {
                if (!isMounted) {
                    return;
                }

                setErrorMsg(currentMessage => {
                    if (hadExistingQuote) {
                        return currentMessage || 'Showing the last known fuel result while live feeds refresh.';
                    }

                    return 'No prices returned. Live station feeds did not return a usable nearby price.';
                });
            } finally {
                if (isMounted) {
                    setIsRefreshingPrices(false);
                }
            }
        };

        const bootstrap = async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') {
                    if (isMounted) {
                        setHasLocationPermission(false);
                        setErrorMsg('Location permission was denied. Allow location to search for the cheapest nearby fuel.');
                    }
                    return;
                }

                if (isMounted) {
                    setHasLocationPermission(true);
                }

                const loc = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                });

                if (!isMounted) {
                    return;
                }

                const nextRegion = {
                    latitude: loc.coords.latitude,
                    longitude: loc.coords.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                };

                setLocation(nextRegion);
                mapRef.current?.animateToRegion(nextRegion, 550);
                setErrorMsg(null);
                setIsLoadingLocation(false);

                await loadFuelData({
                    latitude: loc.coords.latitude,
                    longitude: loc.coords.longitude,
                });
            } catch (error) {
                if (!isMounted) {
                    return;
                }

                setHasLocationPermission(false);
                setErrorMsg('Unable to get your current location. In the iOS Simulator, set a location in Features > Location.');
            } finally {
                if (isMounted) {
                    setIsLoadingLocation(false);
                }
            }
        };

        bootstrap();

        return () => {
            isMounted = false;
        };
    }, []);

    const markerCoordinate = bestQuote
        ? {
            latitude: bestQuote.latitude || location.latitude,
            longitude: bestQuote.longitude || location.longitude,
        }
        : {
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
            >
                <Marker
                    coordinate={markerCoordinate}
                    title={bestQuote ? 'Cheapest Gas' : 'No Prices Returned'}
                    description={
                        bestQuote
                            ? `$${bestQuote.price.toFixed(3)} / gal`
                            : errorMsg
                                ? 'No live station price available'
                                : isLoadingLocation
                                    ? 'Finding your location'
                                    : 'Checking fuel providers'
                    }
                    pinColor={bestQuote ? '#168B57' : '#D46A4C'}
                />
            </MapView>

            <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />

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
                        bottom: overlayBottom,
                        left: horizontalPadding.left,
                        right: horizontalPadding.right,
                    },
                ]}
            >
                <FuelSummaryCard
                    benchmarkQuote={benchmarkQuote}
                    errorMsg={errorMsg}
                    isDark={isDark}
                    isRefreshing={isRefreshingPrices || isLoadingLocation}
                    quote={bestQuote}
                    themeColors={themeColors}
                />
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
        alignItems: 'center',
    },
});
