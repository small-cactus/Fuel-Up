import { t } from '../../localization';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import TrendLeaderboard from './TrendLeaderboard';
import TrendLeaderboardSkeleton from './TrendLeaderboardSkeleton';
export default function NationalTrendPrices({
  quotes,
  loading,
  error,
  gradeLabel,
  isDark,
  themeColors
}) {
  return <View style={styles.container}>
        {loading ? <TrendLeaderboardSkeleton isDark={isDark} themeColors={themeColors} /> : quotes.length ? <TrendLeaderboard national stations={quotes.map(q => ({
      ...q,
      name: q.stationName,
      latestPrice: q.price
    }))} gradeLabel={gradeLabel} isDark={isDark} themeColors={themeColors} /> : <Text style={[styles.empty, {
      color: themeColors.textOpacity
    }]}>{error || t('No {grade} prices reported in the last 24 hours.', { grade: gradeLabel })}</Text>}
    </View>;
}
const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 16
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
