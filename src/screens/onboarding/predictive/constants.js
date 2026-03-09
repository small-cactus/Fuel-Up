export const PREDICTIVE_FUELING_SCENE = {
    origin: {
        latitude: 37.7931,
        longitude: -122.3959,
    },
    expensiveStation: {
        brand: 'Chevron',
        price: 5.29,
        coordinate: {
            latitude: 37.7861,
            longitude: -122.3988,
        },
    },
    destinationStation: {
        brand: 'ARCO',
        price: 4.69,
        coordinate: {
            latitude: 37.7745,
            longitude: -122.4041,
        },
    },
    fallbackRoute: {
        distanceMeters: 2620,
        expectedTravelTimeSeconds: 440,
        coordinates: [
            { latitude: 37.7931, longitude: -122.3959 },
            { latitude: 37.7924, longitude: -122.3961 },
            { latitude: 37.7915, longitude: -122.3965 },
            { latitude: 37.7902, longitude: -122.3970 },
            { latitude: 37.7889, longitude: -122.3976 },
            { latitude: 37.7875, longitude: -122.3982 },
            { latitude: 37.7861, longitude: -122.3988 },
            { latitude: 37.7849, longitude: -122.3994 },
            { latitude: 37.7834, longitude: -122.4002 },
            { latitude: 37.7817, longitude: -122.4012 },
            { latitude: 37.7799, longitude: -122.4022 },
            { latitude: 37.7784, longitude: -122.4030 },
            { latitude: 37.7768, longitude: -122.4035 },
            { latitude: 37.7755, longitude: -122.4038 },
            { latitude: 37.7745, longitude: -122.4041 },
        ],
        steps: [],
    },
    cameraPitch: 62,
    cameraLeadMeters: 140,
    cameraAltitudes: {
        driving: 680,
        passingExpensive: 560,
        routingCheap: 720,
    },
    cameraAnimationMs: 260,
    loopDurationMs: 15000,
    loopHoldDurationMs: 1250,
    frameIntervalMs: 120,
    legalLabelBottomInset: 176,
    cardBottomOffset: 144,
};

export function getPredictiveFuelingFallbackRoute() {
    return {
        coordinates: PREDICTIVE_FUELING_SCENE.fallbackRoute.coordinates,
        distanceMeters: PREDICTIVE_FUELING_SCENE.fallbackRoute.distanceMeters,
        expectedTravelTimeSeconds: PREDICTIVE_FUELING_SCENE.fallbackRoute.expectedTravelTimeSeconds,
        steps: PREDICTIVE_FUELING_SCENE.fallbackRoute.steps,
        isFallback: true,
    };
}
