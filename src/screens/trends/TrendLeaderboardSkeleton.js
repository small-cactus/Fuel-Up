import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
export default function TrendLeaderboardSkeleton({ isDark, themeColors }) {
    const fill = { backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)' };
    return <GlassView glassEffectStyle="regular" style={styles.card} accessibilityLabel="Loading station prices" accessibilityState={{ busy: true }} testID="trend-leaderboard-loading">
        <View style={styles.header}>
            <View style={[styles.title, fill]} />
            <ActivityIndicator color={themeColors.text} />
        </View>
        {[0, 1, 2].map(index => <View key={index} style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.details}>
                <View style={[styles.name, fill, { width: index === 1 ? '65%' : '80%' }]} />
                <View style={[styles.address, fill]} />
            </View>
            <View style={[styles.price, fill]} />
        </View>)}
    </GlassView>;
}
const styles = StyleSheet.create({
    card: { borderRadius: 24, padding: 24, overflow: 'hidden' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    title: { width: '60%', height: 20, borderRadius: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 18 },
    details: { flex: 1, gap: 10 },
    name: { height: 17, borderRadius: 5 },
    address: { height: 13, width: '95%', borderRadius: 4 },
    price: { width: 54, height: 20, borderRadius: 5 },
});
