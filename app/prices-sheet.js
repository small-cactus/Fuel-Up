import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import FuelSummaryCard from '../src/components/FuelSummaryCard';
import { usePreferences } from '../src/PreferencesContext';
import { useTheme } from '../src/ThemeContext';
import { normalizeFuelGrade } from '../src/lib/fuelGrade';

export default function PricesSheet() {
    const { isDark, themeColors } = useTheme();
    const { preferences } = usePreferences();
    const { quotesData, benchmarkData, errorMsg, fuelGrade } = useLocalSearchParams();
    const selectedFuelGrade = normalizeFuelGrade(
        typeof fuelGrade === 'string' ? fuelGrade : preferences.preferredOctane
    );

    // Parse incoming data strings
    const quotes = quotesData ? JSON.parse(quotesData) : [];
    const benchmarkQuote = benchmarkData ? JSON.parse(benchmarkData) : null;
    const error = errorMsg || null;

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <FlatList
                data={quotes.length > 0 ? quotes : [null]} // Render one fallback card if no quotes
                keyExtractor={(item, index) => item?.stationId || index.toString()}
                contentContainerStyle={styles.listContent}
                renderItem={({ item, index }) => (
                    <View style={styles.cardWrapper}>
                        <FuelSummaryCard
                            benchmarkQuote={benchmarkQuote}
                            errorMsg={error}
                            fuelGrade={selectedFuelGrade}
                            isDark={isDark}
                            isRefreshing={false}
                            quote={item}
                            themeColors={themeColors}
                            rank={quotes.length > 0 ? index + 1 : null}
                        />
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    listContent: {
        paddingTop: 24,
        paddingBottom: 40,
        paddingHorizontal: 16,
    },
    cardWrapper: {
        marginBottom: 16,
    },
});
