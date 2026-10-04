import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopCanopy from '../TopCanopy';
import FuelUpHeaderLogo from '../FuelUpHeaderLogo';
import { requireNativeViewManager } from 'expo-modules-core';
import { useAppState } from '../../AppStateContext';
import { usePreferences } from '../../PreferencesContext';
import { useTheme } from '../../ThemeContext';
import useNativeOnboardingData from '../../screens/onboarding/useNativeOnboardingData';

const NativeView = requireNativeViewManager('FuelUpMapKitRouting', 'NativePreferenceView');

export default function PreferencePage({ page }) {
    const insets = useSafeAreaInsets();
    const canopyHeight = insets.top + 44;
    const { preferences, updatePreferences } = usePreferences();
    const { isDark, themeColors } = useTheme();
    const { manualLocationOverride, resolvedFuelSearchContext } = useAppState();
    const initial = useRef(preferences).current;
    const [choices, setChoices] = useState(initial);
    const coordinate = useMemo(() => {
        const origin = manualLocationOverride || resolvedFuelSearchContext;
        return page === 'brands' && Number.isFinite(origin?.latitude) && Number.isFinite(origin?.longitude)
            ? { latitude: origin.latitude, longitude: origin.longitude } : null;
    }, [page, manualLocationOverride, resolvedFuelSearchContext]);
    const { data, retry } = useNativeOnboardingData(coordinate, choices);

    const onAction = useCallback(({ nativeEvent: event }) => {
        if (event.type === 'choices') {
            // Persist only fields owned by this page; onboarding's radius must
            // never replace the user's saved search radius.
            const changes = pageChoices(page, event.choices);
            setChoices(previous => ({ ...previous, ...changes }));
            void updatePreferences(changes);
        } else if (event.type === 'retry') retry();
    }, [page, retry, updatePreferences]);
    const headerTitle = useCallback(() => <FuelUpHeaderLogo isDark={isDark} style={styles.logo} />, [isDark]);
    const options = useMemo(() => ({ headerShown: true, headerTransparent: true, headerTitle,
        headerStyle: { backgroundColor: 'transparent' },
        title: '', headerBackButtonDisplayMode: 'minimal', headerShadowVisible: false,
        headerTintColor: themeColors.text,
        contentStyle: { backgroundColor: themeColors.background } }), [themeColors, headerTitle]);

    const layout = useMemo(() => ({
        container: [styles.container, { backgroundColor: themeColors.background }],
        content: [styles.container, { paddingTop: canopyHeight, paddingBottom: insets.bottom }],
    }), [themeColors.background, canopyHeight, insets.bottom]);

    return <View style={layout.container}>
        <Stack.Screen options={options} />
        <View style={layout.content}>
            <NativeView style={styles.container} page={page} initialChoices={initial} data={data} isDark={isDark}
                testID={`settings-${page}-page`} onAction={onAction} />
        </View>
        <TopCanopy height={canopyHeight} />
    </View>;
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    // Native navigation centers at inset + 22; Settings centers at inset + 19.
    logo: { transform: [{ translateY: -3 }] },
});

function pageChoices(page, choices) {
    return page === 'fuel'
        ? { preferredOctane: choices.preferredOctane, requiresE85: choices.requiresE85 }
        : { preferredBrands: choices.preferredBrands, fuelMemberships: choices.fuelMemberships };
}
