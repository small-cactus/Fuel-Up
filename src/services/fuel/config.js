const DEFAULT_RADIUS_MILES = 10;
const DEFAULT_LIMIT = 8;
const DEFAULT_FUEL_TYPE = 'regular';
const STATION_CACHE_TTL_MS = 10 * 60 * 1000;
const AREA_CACHE_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;

const BLS_SERIES_BY_FUEL = {
    regular: 'APU000074714',
    midgrade: 'APU000074714',
    premium: 'APU000074714',
    diesel: 'APU000074714',
};

const EIA_PRODUCT_BY_FUEL = {
    regular: 'EPMRR',
    midgrade: 'EPMRR',
    premium: 'EPMRR',
    diesel: 'EPMRR',
};

const FRED_SERIES_BY_FUEL = {
    regular: 'GASREGW',
    midgrade: 'GASREGW',
    premium: 'GASREGW',
    diesel: 'GASREGW',
};

function getFuelServiceConfig() {
    return {
        defaultFuelType: DEFAULT_FUEL_TYPE,
        defaultLimit: DEFAULT_LIMIT,
        defaultRadiusMiles: DEFAULT_RADIUS_MILES,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        stationCacheTtlMs: STATION_CACHE_TTL_MS,
        areaCacheTtlMs: AREA_CACHE_TTL_MS,
        tomTomApiKey: process.env.EXPO_PUBLIC_TOMTOM_API_KEY || '',
        barchartApiKey: process.env.EXPO_PUBLIC_BARCHART_API_KEY || '',
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        cardogApiKey: process.env.EXPO_PUBLIC_CARDOG_API_KEY || '',
        eiaApiKey: process.env.EXPO_PUBLIC_EIA_API_KEY || '',
        fredApiKey: process.env.EXPO_PUBLIC_FRED_API_KEY || '',
    };
}

module.exports = {
    BLS_SERIES_BY_FUEL,
    EIA_PRODUCT_BY_FUEL,
    FRED_SERIES_BY_FUEL,
    getFuelServiceConfig,
};
