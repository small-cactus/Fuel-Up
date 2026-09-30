// Minimax decisions within explicit, uncalibrated price scenarios. These are
// model assumptions, not guaranteed bounds on an unknown pump price.
export function scenarioQuotes(estimates) {
    return estimates.map(row => {
        const low = row.rawPrice;
        const high = Math.max(low, row.scenarioHigh);
        if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0) throw new Error('Invalid price scenario');
        return { stationId: row.stationId, low, high, predictedPrice: (low + high) / 2,
            isEstimated: high > low, source: row };
    });
}

export function chooseMinimaxStation(quotes) {
    if (!quotes.length) return null;
    if (new Set(quotes.map(row => row.stationId)).size !== quotes.length) throw new Error('Duplicate station identity');
    if (quotes.some(row => !Number.isFinite(row.low) || !Number.isFinite(row.high) || row.low > row.high || row.low <= 0)) throw new Error('Invalid price bounds');
    const choices = quotes.map(row => {
        const alternatives = quotes.filter(other => other.stationId !== row.stationId);
        const worstRegret = alternatives.length ? Math.max(0, row.high - Math.min(...alternatives.map(other => other.low))) : 0;
        return { ...row, scenarioWorstRegret: worstRegret };
    });
    choices.sort((a,b) => a.scenarioWorstRegret-b.scenarioWorstRegret || a.low-b.low ||
        (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0));
    return choices[0];
}
