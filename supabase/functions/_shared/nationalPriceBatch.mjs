export function priceQuery(ids) {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Price IDs must be nonempty and unique');
  return `query StatePrices{${ids.map((id, i) => `s${i}:station(id:${JSON.stringify(id)}){...P}`).join(' ')}}
    fragment P on Station{id prices{fuelProduct cash{price postedTime} credit{price postedTime}}}`;
}

export function validatePriceBatch(data, ids) {
  if (!data || Object.keys(data).length !== ids.length) throw new Error('Missing or extra price batch results');
  return ids.map((id, i) => {
    const station = data[`s${i}`];
    if (station?.id !== id || !Array.isArray(station.prices)) throw new Error(`Missing or mismatched price result for ${id}`);
    const fuels = new Set();
    for (const price of station.prices) {
      if (typeof price.fuelProduct !== 'string' || fuels.has(price.fuelProduct)) throw new Error(`Invalid fuel entries for ${id}`);
      fuels.add(price.fuelProduct);
      for (const payment of ['cash', 'credit']) {
        const quote = price[payment];
        if (quote == null) continue;
        if (!Number.isFinite(quote.price) || quote.price < 0 || (quote.postedTime != null && typeof quote.postedTime !== 'string')) {
          throw new Error(`Invalid ${payment} quote for ${id}`);
        }
      }
    }
    return station;
  });
}
