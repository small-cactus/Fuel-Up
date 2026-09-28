import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import FuelSummaryCard from '../src/components/FuelSummaryCard';
import { usePreferences } from '../src/PreferencesContext';
import { useTheme } from '../src/ThemeContext';
import { parsePricesSheetParams } from '../src/lib/pricesSheetParams';
import { normalizeFuelGrade } from '../src/lib/fuelGrade';
import { openStationNavigation } from '../src/lib/openNavigation';

export default function PricesSheet() {
    const { isDark, themeColors } = useTheme();
    const { preferences } = usePreferences();
    const { quotesData, benchmarkData, errorMsg, fuelGrade } = useLocalSearchParams();
    const selectedFuelGrade = normalizeFuelGrade(
        typeof fuelGrade === 'string' ? fuelGrade : preferences.preferredOctane
    );
    const { quotes, error } = useMemo(() => (
        parsePricesSheetParams({ quotesData, benchmarkData, errorMsg })
    ), [quotesData, benchmarkData, errorMsg]);
    const navigate = useCallback(quote => {
        void openStationNavigation({
            latitude: quote.latitude,
            longitude: quote.longitude,
            label: quote.stationName,
            navigationApp: preferences.navigationApp,
        });
    }, [preferences.navigationApp]);

    // Let the native form sheet measure its content. Fixed detents with flex: 1
    // can give an iOS scroll container zero intrinsic height.
    return (
        <ScrollView testID="prices-sheet" style={{ backgroundColor: themeColors.background }}
            contentContainerStyle={styles.listContent} contentInsetAdjustmentBehavior="automatic">
            {quotes.length ? quotes.map((quote, index) => (
                <View key={quote.stationId || index} style={styles.cardWrapper}>
                    <FuelSummaryCard quote={quote} fuelGrade={selectedFuelGrade} rank={index + 1}
                        isDark={isDark} themeColors={themeColors} isRefreshing={false} onNavigatePress={navigate} />
                </View>
            )) : (
                <View style={styles.empty}>
                    <Text style={[styles.title, { color: themeColors.text }]}>No prices to show</Text>
                    <Text style={[styles.message, { color: themeColors.text }]}>{error || 'Return to Home to refresh nearby stations.'}</Text>
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    listContent: { paddingTop: 24, paddingBottom: 24, paddingHorizontal: 16 },
    cardWrapper: { marginBottom: 16 },
    empty: { padding: 24, gap: 10 },
    title: { fontSize: 20, fontWeight: '700' },
    message: { fontSize: 16, lineHeight: 22, opacity: 0.65 },
});
