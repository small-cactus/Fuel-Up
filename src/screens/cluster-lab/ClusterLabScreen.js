import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../../ThemeContext';
import { usePreferences } from '../../PreferencesContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openStationNavigation } from '../../lib/openNavigation';
import { onboardingHandoff } from '../../lib/onboardingHandoff';
import { finishLaunch } from '../../lib/launchReadiness';
import { useLaunchReady } from '../../components/LaunchSplash';
import useClusterLabStations from './useClusterLabStations';
import useHomeDeviceLocation from './useHomeDeviceLocation';
import StationCardCarousel from './StationCardCarousel';
import FuelUpHeaderLogo from '../../components/FuelUpHeaderLogo';
import TopCanopy from '../../components/TopCanopy';
import useNetworkStatus from '../../lib/useNetworkStatus';

const NativeMap = Platform.OS === 'ios' ? requireNativeViewManager('FuelUpMapKitRouting') : null;
const EMPTY_ORIGIN = {};

export default function HomeScreen() {
    const active = useIsFocused();
    const network = useNetworkStatus();
    const unavailable = network.connected === false || network.services.some(service => service.status === 'unresponsive');
    useEffect(() => { if (unavailable) finishLaunch(); }, [unavailable]);
    const revealed = useLaunchReady();
    useHomeDeviceLocation(active);
    const { isDark, themeColors } = useTheme();
    const { preferences, fuelSearchCriteriaSignature } = usePreferences();
    const insets = useSafeAreaInsets();
    const headerStyle = useMemo(() => [styles.header, { paddingTop: insets.top }], [insets.top]);
    const { origin, stations: allStations, loaded, error } = useClusterLabStations(active);
    useEffect(() => { if (error) onboardingHandoff.fail(new Error('Could not load nearby prices. Check your connection and try Save again.')); }, [error]);
    const mapReady = useCallback(() => { finishLaunch(); onboardingHandoff.mapReady(); }, []);
    const { clusterLabProbe } = useLocalSearchParams();
    const map = useRef(null);
    const carousel = useRef(null);
    const [clusterIDs, setClusterIDs] = useState(null);
    const stations = useMemo(() => clusterIDs ? allStations.filter(station => clusterIDs.includes(station.id)) : allStations, [allStations, clusterIDs]);
    const [selectedId, setSelectedId] = useState(null);
    const [overview, setOverview] = useState(true);
    const [overlayHeight, setOverlayHeight] = useState(0);
    const selection = !overview && stations.some(station => station.id === selectedId) ? selectedId : stations[0]?.id;
    const selectionRef = useRef(selection);
    const previousCriteria = useRef(fuelSearchCriteriaSignature);
    selectionRef.current = selection;
    useEffect(() => {
        if (active) {
            setClusterIDs(null);
            setOverview(true);
            setSelectedId(null);
            carousel.current?.scrollTo(0, false);
        }
    }, [active]);
    useEffect(() => {
        if (previousCriteria.current === fuelSearchCriteriaSignature) return;
        previousCriteria.current = fuelSearchCriteriaSignature;
        setClusterIDs(null);
        setSelectedId(null);
        setOverview(true);
        // Settings changes happen while this tab is detached. The native
        // active transition restores its overview when Home becomes visible.
        if (active) void map.current?.showAll();
    }, [fuelSearchCriteriaSignature, active]);
    useEffect(() => {
        if (selectedId !== selection) {
            setSelectedId(selection || null);
            carousel.current?.scrollTo(0, false);
        }
    }, [selectedId, selection]);
    useEffect(() => {
        const index = stations.findIndex(station => station.id === selectionRef.current);
        if (index >= 0) carousel.current?.scrollTo(index, false);
    }, [stations]);
    const select = useCallback(id => {
        setOverview(false);
        setSelectedId(id);
        void map.current?.focusStation(id);
    }, []);
    const showAll = useCallback(() => {
        setClusterIDs(null);
        setOverview(true);
        setSelectedId(allStations[0]?.id || null);
        carousel.current?.scrollTo(0, false);
        void map.current?.showAll();
    }, [allStations]);
    const overviewChanged = useCallback(event => setOverview(event.nativeEvent.overview), []);
    const mapSelected = useCallback(event => {
        const id = event.nativeEvent.id;
        const ids = event.nativeEvent.stationIDs;
        const members = ids?.length ? ids : null;
        const next = members ? allStations.filter(station => members.includes(station.id)) : allStations;
        setClusterIDs(members);
        const index = next.findIndex(station => station.id === id);
        if (index < 0) return;
        setOverview(false);
        setSelectedId(id);
        carousel.current?.scrollTo(index);
    }, [allStations]);
    const navigate = useCallback(station => {
        void openStationNavigation({ latitude: station.latitude, longitude: station.longitude,
            label: station.name, navigationApp: preferences.navigationApp });
    }, [preferences.navigationApp]);
    if (!NativeMap) return <View style={styles.map} />;
    return (
        <View style={styles.map}>
        <NativeMap ref={map}
            style={StyleSheet.absoluteFill}
            origin={origin || EMPTY_ORIGIN}
            stations={allStations}
            isDark={isDark}
            active={active}
            overlayBottomInset={stations.length ? overlayHeight + 8 : 0}
            contentReady={loaded && (!stations.length || overlayHeight > 0)}
            revealed={revealed}
            onMapReady={mapReady}
            onStationSelect={mapSelected}
            onOverviewChange={overviewChanged}
            probeToken={__DEV__ && typeof clusterLabProbe === 'string' ? clusterLabProbe : null}
        />
        {stations.length > 0 && <StationCardCarousel ref={carousel} stations={stations} selectedId={selection}
            active={active} bottom={insets.bottom + 12} fuelGrade={preferences.preferredOctane}
            isDark={isDark} themeColors={themeColors} onSelect={select} onNavigate={navigate}
            onHeight={setOverlayHeight} onShowAll={showAll} overview={overview} />}
        <TopCanopy height={insets.top + 44} />
        <View pointerEvents="none" style={headerStyle}>
            <FuelUpHeaderLogo isDark={isDark} />
        </View>
        </View>
    );
}

const styles = StyleSheet.create({
    map: { flex: 1 },
    header: {
        position: 'absolute', top: 0, left: 0, right: 0,
        alignItems: 'center', paddingBottom: 10, zIndex: 10,
    },
});
