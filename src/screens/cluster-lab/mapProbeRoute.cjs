const first = value => Array.isArray(value) ? value[0] : value;
const enabled = value => Array.isArray(value)
    ? value.some(enabled)
    : ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());

// Normal iOS automation exercises the same Swift MapKit renderer as Release.
// The retained React Native regression probe requires an explicit legacy flag.
function usesLegacyMapProbe(params, platform) {
    return platform !== 'ios' || enabled(params?.legacyClusterProbe);
}

function nativeMapProbeToken(params, isDev) {
    if (!isDev || enabled(params?.legacyClusterProbe)) return null;
    const nativeToken = first(params?.clusterLabProbe);
    if (typeof nativeToken === 'string' && nativeToken) return nativeToken;
    if (!enabled(params?.clusterProbe) && !enabled(params?.runClusterProbe)) return null;
    const token = first(params?.clusterProbeToken) || first(params?.probeToken);
    return typeof token === 'string' && token ? token : 'native-default';
}

module.exports = { usesLegacyMapProbe, nativeMapProbeToken };
