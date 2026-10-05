// The fallback and its UI share one deadline; the overlay has no error timer.
const NATIONAL_API_TIMEOUT_MS = 20_000;
const MAP_API_TIMEOUT_MS = NATIONAL_API_TIMEOUT_MS;
const DEFAULT_API_TIMEOUT_MS = 15_000;
function apiRequestTimeout(input, init) {
    const url = String(input?.url || input);
    if (url.includes('/functions/v1/gas-prices')) {
        let body;
        try { body = JSON.parse(init?.body || '{}'); } catch { /* Local request default. */ }
        return body?.scope === 'national' ? NATIONAL_API_TIMEOUT_MS : MAP_API_TIMEOUT_MS;
    }
    return DEFAULT_API_TIMEOUT_MS;
}
module.exports = { MAP_API_TIMEOUT_MS, NATIONAL_API_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS, apiRequestTimeout };
