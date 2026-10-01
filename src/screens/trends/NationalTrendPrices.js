import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import TrendLeaderboard from './TrendLeaderboard';
export default function NationalTrendPrices({
  quotes,
  loading,
  error,
  gradeLabel,
  isDark,
  themeColors
}) {
  return <View style={styles.container}>
        {loading ? <ActivityIndicator accessibilityLabel="Loading national prices" color={themeColors.text} style={styles.loading} /> : quotes.length ? <TrendLeaderboard national stations={quotes.map(q => ({
      ...q,
      name: q.stationName,
      latestPrice: q.price
    }))} gradeLabel={gradeLabel} isDark={isDark} themeColors={themeColors} /> : <Text style={[styles.empty, {
      color: themeColors.textOpacity
    }]}>{error || `No ${gradeLabel.toLowerCase()} prices reported in the last 24 hours.`}</Text>}
    </View>;
}
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingBottom: 24
  },
  loading: {
    marginTop: 40
  },
  empty: {
    fontSize: 16,
    textAlign: 'center',
    paddingVertical: 32
  }
});
