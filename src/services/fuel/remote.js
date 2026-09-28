const { sanitizeStationQuotesForFuelType } = require('./stationData');

async function fetchGasBuddyQuote({ latitude, longitude, radiusMiles, fuelType, requiresE85 = false, config, forceLive }) {
    const debugEntry = {
        providerId: 'gasbuddy', providerTier: 'station', enabled: true,
        quoteReturned: false, failureCategory: null, requests: [], summary: {}, error: null,
    };
    try {
        const { supabase } = require('../../lib/supabase');
        if (!supabase) throw new Error('Supabase is not configured.');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        let result;
        try {
            result = await supabase.functions.invoke('gas-prices', {
                body: { latitude, longitude, radiusMiles, fuelType, requiresE85, forceRefresh: Boolean(forceLive) },
                signal: controller.signal,
                region: 'us-east-2',
            });
        } finally { clearTimeout(timer); }
        if (result.error) throw result.error;
        const data = result.data;
        if (data?.version !== 1 || !Array.isArray(data.quotes)) throw new Error('Invalid gas-prices response.');
        const quotes = sanitizeStationQuotesForFuelType(data.quotes.filter(q => q.providerId === 'gasbuddy'), fuelType);
        debugEntry.summary = { ...data.summary, source: data.source, totalQuoteCount: quotes.length };
        debugEntry.quoteReturned = quotes.length > 0;
        debugEntry.requests.push({ step: 'gas-prices', url: 'supabase://functions/gas-prices', status: 200,
            output: { source: data.source, count: quotes.length }, error: null });
        if (!quotes.length) {
            debugEntry.error = 'No nearby GasBuddy prices are available.';
            debugEntry.failureCategory = data.summary?.resultCount === 0 ? 'location' : 'price';
        }
        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat(data.source === 'live' ? 'gasbuddy' : 'supabase');
        return { debugEntry, quotes };
    } catch (error) {
        debugEntry.error = error?.message || 'Gas price service unavailable.';
        debugEntry.failureCategory = 'network';
        return { debugEntry, quotes: [] };
    }
}
module.exports = { fetchGasBuddyQuote };
