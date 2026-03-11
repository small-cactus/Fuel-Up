export const ONBOARDING_STEPS = [
    'welcome',
    'predictive',
    'location',
    'notifications',
    'radius',
    'octane',
];

export function buildOnboardingPreferenceUpdates({
    currentStep,
    radius,
    octane,
}) {
    const updates = [];

    if (ONBOARDING_STEPS[currentStep] === 'radius') {
        updates.push(['searchRadiusMiles', radius]);
    }

    if (ONBOARDING_STEPS[currentStep] === 'octane') {
        updates.push(['preferredOctane', octane]);
    }

    return updates;
}

export function isTranslucentOnboardingStep(currentStep) {
    return currentStep === 0 || currentStep === 1 || currentStep === 4;
}
