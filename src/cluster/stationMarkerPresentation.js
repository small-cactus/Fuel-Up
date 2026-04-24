export function buildStationMarkerViewTrackingSignature({
  quote = null,
  isBest = false,
  isActive = false,
  isDark = false,
  useOnboardingColors = false,
}) {
  return [
    quote?.stationId ?? '',
    quote?.price ?? '',
    isBest ? '1' : '0',
    isActive ? '1' : '0',
    isDark ? '1' : '0',
    useOnboardingColors ? '1' : '0',
  ].join('|');
}
