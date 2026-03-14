const AsyncStorage = require('@react-native-async-storage/async-storage').default || require('@react-native-async-storage/async-storage');

const DEV_API_STATS_KEY = '@fuelup_dev_stats';

async function getApiStats() {
    try {
        const data = await AsyncStorage.getItem(DEV_API_STATS_KEY);
        if (data) {
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Failed to get api stats', e);
    }
    return { primary: 0, secondary: 0, supabase: 0, barchart: 0, tomtom: 0 };
}

async function incrementApiStat(providerId) {
    try {
        const stats = await getApiStats();
        stats[providerId] = (stats[providerId] || 0) + 1;
        await AsyncStorage.setItem(DEV_API_STATS_KEY, JSON.stringify(stats));
        return stats;
    } catch (e) {
        console.error('Failed to update api stats', e);
    }
}

async function resetApiStats() {
    const freshStats = { primary: 0, secondary: 0, supabase: 0, barchart: 0, tomtom: 0 };
    try {
        await AsyncStorage.setItem(DEV_API_STATS_KEY, JSON.stringify(freshStats));
    } catch (e) {
        console.error('Failed to reset api stats', e);
    }
    return freshStats;
}

module.exports = {
    getApiStats,
    incrementApiStat,
    resetApiStats,
};
