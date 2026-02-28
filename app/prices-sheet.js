import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import FuelSummaryCard from '../src/components/FuelSummaryCard';
import { useTheme } from '../src/ThemeContext';

export default function PricesSheet() {
    const { isDark, themeColors } = useTheme();
    const { quotesData, benchmarkData, errorMsg } = useLocalSearchParams();

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
