const DEFAULT_RADIUS_MILES = 10;
const DEFAULT_LIMIT = 24;
const DEFAULT_FUEL_TYPE = 'regular';
const STATION_CACHE_TTL_MS = 10 * 60 * 1000;
const AREA_CACHE_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

function getFuelServiceConfig() {
    return {
        defaultFuelType: DEFAULT_FUEL_TYPE,
        defaultLimit: DEFAULT_LIMIT,
        defaultRadiusMiles: DEFAULT_RADIUS_MILES,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        stationCacheTtlMs: STATION_CACHE_TTL_MS,
        areaCacheTtlMs: AREA_CACHE_TTL_MS,
    };
}

module.exports = { getFuelServiceConfig };
