function parseParam(value, fallback) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string' || !raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parsePricesSheetParams({ quotesData, benchmarkData, errorMsg }) {
    const parsedQuotes = parseParam(quotesData, []);
    const benchmark = parseParam(benchmarkData, null);
    return {
        quotes: Array.isArray(parsedQuotes) ? parsedQuotes.filter(isRecord) : [],
        benchmarkQuote: isRecord(benchmark) ? benchmark : null,
        error: typeof errorMsg === 'string' ? errorMsg : null,
    };
}
