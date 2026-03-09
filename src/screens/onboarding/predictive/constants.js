export const PREDICTIVE_FUELING_SCENE = {
    origin: {
        latitude: 37.7875,
        longitude: -122.3922,
    },
    expensiveStation: {
        brand: 'Shell',
        price: 5.39,
        coordinate: {
            latitude: 37.779919,
            longitude: -122.398028,
        },
    },
    destinationStation: {
        brand: 'Chevron',
        price: 4.99,
        coordinate: {
            latitude: 37.777304,
            longitude: -122.404647,
        },
    },
    fallbackRoute: {
        distanceMeters: 1677,
        expectedTravelTimeSeconds: 374,
        coordinates: [
            { latitude: 37.787397, longitude: -122.392634 },
            { latitude: 37.787295, longitude: -122.392776 },
            { latitude: 37.787241, longitude: -122.392708 },
            { latitude: 37.786841, longitude: -122.392198 },
            { latitude: 37.786760, longitude: -122.392076 },
            { latitude: 37.786603, longitude: -122.392278 },
            { latitude: 37.786117, longitude: -122.392898 },
            { latitude: 37.785807, longitude: -122.393280 },
            { latitude: 37.785219, longitude: -122.394025 },
            { latitude: 37.783442, longitude: -122.396302 },
            { latitude: 37.782864, longitude: -122.397031 },
            { latitude: 37.782569, longitude: -122.397405 },
            { latitude: 37.780787, longitude: -122.399660 },
            { latitude: 37.778604, longitude: -122.402392 },
            { latitude: 37.777015, longitude: -122.404409 },
            { latitude: 37.777091, longitude: -122.404512 },
            { latitude: 37.777167, longitude: -122.404615 },
            { latitude: 37.777196, longitude: -122.404581 },
            { latitude: 37.777276, longitude: -122.404682 },
        ],
        steps: [
            {
                instructions: 'Turn left onto Fremont St',
                distanceMeters: 17,
                expectedTravelTimeSeconds: 4,
                coordinate: { latitude: 37.787397, longitude: -122.392634 },
            },
            {
                instructions: 'Turn right onto Harrison St',
                distanceMeters: 86,
                expectedTravelTimeSeconds: 13,
                coordinate: { latitude: 37.787295, longitude: -122.392776 },
            },
            {
                instructions: 'Turn right into the parking lot',
                distanceMeters: 1533,
                expectedTravelTimeSeconds: 343,
                coordinate: { latitude: 37.786760, longitude: -122.392076 },
            },
            {
                instructions: 'Arrive at the destination',
                distanceMeters: 42,
                expectedTravelTimeSeconds: 14,
                coordinate: { latitude: 37.777015, longitude: -122.404409 },
            },
        ],
    },
    cameraPitch: 62,
    cameraLeadMeters: 140,
    routeSpacingMeters: 6,
    turnPreview: {
        altitude: 840,
        centerBlend: 0.36,
        headingBlend: 0.74,
        lookaheadMeters: 120,
        minimumTurnDistanceMeters: 18,
        postTurnSampleMeters: 76,
    },
    cameraProfiles: {
        intro: {
            altitude: 640,
            leadMeters: 130,
            pitch: 64,
        },
        cruise: {
            altitude: 1220,
            leadMeters: 220,
            pitch: 16,
        },
        showcase: {
            altitude: 720,
            leadMeters: 136,
            pitch: 58,
        },
    },
    cameraAltitudes: {
        driving: 680,
        passingExpensive: 560,
        routingCheap: 720,
    },
    cameraAnimationMs: 0,
    cameraUpdateIntervalMs: 0,
    loopDurationMs: 12400,
    loopHoldDurationMs: 1250,
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
