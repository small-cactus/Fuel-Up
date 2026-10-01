const {
  isFreshReportedQuote
} = require('./reportedPrices');
async function fetchNationalTrends({
  fuelType,
  requiresE85 = false,
  signal
}) {
  const {
    supabase
  } = require('../../lib/supabase');
  if (!supabase) throw new Error('Price service unavailable.');
  const {
    data,
    error
  } = await supabase.functions.invoke('gas-prices', {
    body: {
      scope: 'national',
      fuelType,
      requiresE85
    },
    region: 'us-east-2',
    signal
  });
  if (error || data?.scope !== 'national' || !Array.isArray(data?.quotes)) throw new Error('Unable to load national prices. Pull to refresh to try again.');
  const quotes = data.quotes.filter(q => q.fuelType === fuelType && isFreshReportedQuote(q)).sort((a, b) => a.price - b.price || a.stationId.localeCompare(b.stationId)).slice(0, 5);
  const averagePricesByDay = (data.history || []).filter(point =>
    Number.isFinite(Date.parse(point.date)) && Number.isFinite(point.price) && point.price > 0
  ).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const delta = averagePricesByDay.length > 1
    ? averagePricesByDay.at(-1).price - averagePricesByDay[0].price : null;
  return { quotes, scanId: data.scanId, completedAt: data.completedAt, refreshAfter: data.refreshAfter, trendData: {
    averagePricesByDay,
    overallTrend: delta === null ? null : { delta, isIncrease: delta > 0, isDecrease: delta < 0 },
  }, historyError: data.historyError || null };
}
async function fetchNationalLeaderboard(options) {
  return (await fetchNationalTrends(options)).quotes;
}
module.exports = {
  fetchNationalLeaderboard, fetchNationalTrends
};
