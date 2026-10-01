export const ONBOARDING_STEPS = [
    'welcome',
    'predictive',
    'location',
    'memberships',
    'notifications',
    'radius',
    'octane',
    'brands',
];

export function buildOnboardingPreferenceUpdates({
    currentStep,
    radius,
    octane,
    requiresE85 = false,
    fuelMemberships = [],
}) {
    const updates = [];

    if (ONBOARDING_STEPS[currentStep] === 'radius') {
        updates.push(['searchRadiusMiles', radius]);
    }

    if (ONBOARDING_STEPS[currentStep] === 'octane') {
        updates.push(['preferredOctane', octane]);
        updates.push(['requiresE85', Boolean(requiresE85)]);
    }

    if (ONBOARDING_STEPS[currentStep] === 'memberships') updates.push(['fuelMemberships', fuelMemberships]);
    return updates;
}

export function isTranslucentOnboardingStep(currentStep) {
    return ['welcome', 'predictive', 'radius'].includes(ONBOARDING_STEPS[currentStep]);
}
