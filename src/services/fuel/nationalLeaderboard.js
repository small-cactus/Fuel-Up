const {
  isFreshReportedQuote
} = require('./reportedPrices');
async function fetchNationalLeaderboard({
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
  return data.quotes.filter(q => q.fuelType === fuelType && isFreshReportedQuote(q)).sort((a, b) => a.price - b.price || a.stationId.localeCompare(b.stationId)).slice(0, 5);
}
module.exports = {
  fetchNationalLeaderboard
};
