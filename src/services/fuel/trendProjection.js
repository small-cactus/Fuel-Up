function applyCurrentStationQuoteProjection(rows, latestQuotes) {
    if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(latestQuotes) || latestQuotes.length === 0) {
        return rows || [];
    }

    const latestTimestampByStationId = new Map();
    const latestQuoteByStationId = new Map();

    rows.forEach(row => {
        const stationId = String(row?.station_id || '').trim();
        const timestampMs = Number(row?.timestampMs);

        if (!stationId || !Number.isFinite(timestampMs)) {
            return;
        }

        const currentTimestamp = latestTimestampByStationId.get(stationId) ?? Number.NEGATIVE_INFINITY;

        if (timestampMs >= currentTimestamp) {
            latestTimestampByStationId.set(stationId, timestampMs);
        }
    });

    latestQuotes.forEach(quote => {
        const stationId = String(quote?.stationId || '').trim();

        if (!stationId) {
            return;
        }

        latestQuoteByStationId.set(stationId, quote);
    });

    return rows.map(row => {
        const stationId = String(row?.station_id || '').trim();
        const timestampMs = Number(row?.timestampMs);
        const latestTimestampMs = latestTimestampByStationId.get(stationId);
        const latestQuote = latestQuoteByStationId.get(stationId);

        if (
            !stationId ||
            !latestQuote ||
            !Number.isFinite(timestampMs) ||
            timestampMs !== latestTimestampMs
        ) {
            return row;
        }

        const validation = latestQuote.validation || null;

        return {
            ...row,
            price: Number(latestQuote.price),
            api_price: validation?.apiPrice ?? row.api_price ?? null,
            predicted_price: validation?.predictedPrice ?? row.predicted_price ?? null,
            used_prediction: validation?.usedPrediction ?? row.used_prediction ?? false,
            validation_decision: validation?.decision ?? row.validation_decision ?? null,
            risk: validation?.risk ?? row.risk ?? null,
            validity: validation?.validity ?? row.validity ?? null,
        };
    });
}

module.exports = {
    applyCurrentStationQuoteProjection,
};
