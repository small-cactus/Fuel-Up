import { supabase } from '../../lib/supabase';

// Helper: Calculate distance between two coords in miles
function getDistanceMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of the earth in miles
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export async function fetchTrendData({ latitude, longitude, fuelType = 'regular' }) {
    const searchLat = Math.round(latitude * 10) / 10;
    const searchLng = Math.round(longitude * 10) / 10;

    const { data: rows, error } = await supabase
        .from('station_prices')
        .select('*')
        .eq('search_latitude_rounded', searchLat)
        .eq('search_longitude_rounded', searchLng)
        .eq('fuel_type', fuelType)
        .order('created_at', { ascending: true });

    if (error || !rows || rows.length === 0) {
        return {
            overallTrend: null,
            averagePricesByDay: [],
            stationsWithLargestDelta: [],
            competitorClusters: [],
            mapHeatmapPoints: [],
        };
    }

    // 1. Average prices grouped by day (for the main chart)
    const dayAggregation = {};
    rows.forEach(row => {
        const dateStr = new Date(row.created_at).toISOString().split('T')[0];
        if (!dayAggregation[dateStr]) {
            dayAggregation[dateStr] = { sum: 0, count: 0 };
        }
        dayAggregation[dateStr].sum += row.price;
        dayAggregation[dateStr].count += 1;
    });

    const averagePricesByDay = Object.keys(dayAggregation).sort().map(date => {
        return {
            date,
            price: dayAggregation[date].sum / dayAggregation[date].count
        };
    });

    // Determine overall area trend
    let overallTrend = null;
    if (averagePricesByDay.length >= 2) {
        const firstPrice = averagePricesByDay[0].price;
        const lastPrice = averagePricesByDay[averagePricesByDay.length - 1].price;
        const delta = lastPrice - firstPrice;
        overallTrend = {
            delta,
            isIncrease: delta > 0,
            isDecrease: delta < 0
        };
    }

    // 2. Stations with the largest delta and grouping for competition
    const stationAggregation = {};
    // For heatmap, average price of each station over its history
    const mapHeatmapPoints = [];

    rows.forEach(row => {
        if (!stationAggregation[row.station_id]) {
            stationAggregation[row.station_id] = {
                stationId: row.station_id,
                name: row.station_name,
                address: row.address,
                latitude: row.latitude,
                longitude: row.longitude,
                prices: [],
                updatesCount: 0,
                priceJumps: [],
            };
        }
        const st = stationAggregation[row.station_id];

        // Check if price changed from last known price
        const lastKnownPrice = st.prices.length > 0 ? st.prices[st.prices.length - 1].price : null;
        if (lastKnownPrice !== null && lastKnownPrice !== row.price) {
            st.updatesCount += 1;
            st.priceJumps.push({
                date: row.created_at,
                amount: row.price - lastKnownPrice
            });
        }

        // Only push unique consecutive prices so we don't end up with math against duplicates
        if (lastKnownPrice !== row.price) {
            st.prices.push({
                date: row.created_at,
                price: row.price
            });
        }
    });

    const stations = Object.values(stationAggregation);

    // Calculate max delta per station and distance to user
    stations.forEach(st => {
        const pricesOnly = st.prices.map(p => p.price);
        st.minPrice = Math.min(...pricesOnly);
        st.maxPrice = Math.max(...pricesOnly);
        st.delta = st.maxPrice - st.minPrice;
        st.distanceMiles = getDistanceMiles(latitude, longitude, st.latitude, st.longitude);

        const avgPrice = pricesOnly.reduce((a, b) => a + b, 0) / pricesOnly.length;
        mapHeatmapPoints.push({
            latitude: st.latitude,
            longitude: st.longitude,
            weight: avgPrice, // We can use average price as weight for heatmap
            stationId: st.stationId,
            averagePrice: avgPrice
        });
    });

    // Leaderboard logic instead of max delta
    // 1. Get earliest known price and latest known price for each station
    // 2. Rank stations based on earliest price
    // 3. Rank stations based on latest price
    // 4. Calculate rank delta
    stations.forEach(st => {
        const prices = st.prices;
        if (prices.length > 0) {
            st.earliestPrice = prices[0].price;
            st.latestPrice = prices[prices.length - 1].price;
        } else {
            st.earliestPrice = Infinity;
            st.latestPrice = Infinity;
        }
    });

    const earliestRanking = [...stations].sort((a, b) => {
        if (a.earliestPrice === b.earliestPrice) return String(a.stationId).localeCompare(String(b.stationId));
        return a.earliestPrice - b.earliestPrice;
    });

    // Assign earliest rank
    earliestRanking.forEach((st, idx) => {
        st.earliestRank = idx;
    });

    const latestRanking = [...stations].sort((a, b) => {
        if (a.latestPrice === b.latestPrice) return String(a.stationId).localeCompare(String(b.stationId));
        return a.latestPrice - b.latestPrice;
    });

    // Assign latest rank and calculate shift
    latestRanking.forEach((st, idx) => {
        st.latestRank = idx;
        // Positive means they improved (moved up the leaderboard to a smaller index)
        // e.g. from rank 5 (index 4) to rank 2 (index 1) -> 4 - 1 = +3
        st.rankShift = st.earliestRank - st.latestRank;
    });

    const leaderboard = latestRanking
        .filter(st => st.prices.length > 0)
        .slice(0, 5); // Return top 5 currently cheapest

    // 3. Competitor Clusters (Stations within 0.5 miles of each other)
    const processedPairs = new Set();
    const competitorClusters = [];

    for (let i = 0; i < stations.length; i++) {
        for (let j = i + 1; j < stations.length; j++) {
            const st1 = stations[i];
            const st2 = stations[j];
            const pairKey = `${st1.stationId}-${st2.stationId}`;

            if (processedPairs.has(pairKey)) continue;
            processedPairs.add(pairKey);

            const distance = getDistanceMiles(st1.latitude, st1.longitude, st2.latitude, st2.longitude);
            if (distance <= 0.5) { // Same block / very close
                // Check if they update frequently
                const combinedUpdates = st1.updatesCount + st2.updatesCount;
                if (combinedUpdates > 0) {
                    // Calculate typical schedule / amount
                    const allJumps = [...st1.priceJumps, ...st2.priceJumps];
                    const avgJumpAmount = allJumps.length > 0
                        ? allJumps.reduce((acc, jump) => acc + Math.abs(jump.amount), 0) / allJumps.length
                        : 0;

                    competitorClusters.push({
                        stations: [st1, st2],
                        distanceMiles: distance,
                        totalUpdates: combinedUpdates,
                        averageJumpAmount: avgJumpAmount,
                        updateFrequencyDesc: combinedUpdates > 5 ? 'High frequency' : 'Moderate frequency'
                    });
                }
            }
        }
    }

    // Sort clusters by most competitive
    competitorClusters.sort((a, b) => b.totalUpdates - a.totalUpdates);

    return {
        overallTrend,
        averagePricesByDay,
        leaderboard,
        competitorClusters: competitorClusters.slice(0, 5), // Top 5 competitive blocks
        mapHeatmapPoints
    };
}
