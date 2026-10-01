import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildOnboardingPreferenceUpdates,
    isTranslucentOnboardingStep,
    ONBOARDING_STEPS,
} from '../src/lib/onboardingFlow.js';

test('onboarding flow places optional brand preferences after fuel grade', () => {
    assert.deepEqual(ONBOARDING_STEPS, [
        'welcome',
        'predictive',
        'location',
        'memberships',
        'notifications',
        'radius',
        'octane',
        'brands',
    ]);
});

test('onboarding only commits radius and octane on their respective steps', () => {
    assert.deepEqual(
        buildOnboardingPreferenceUpdates({
            currentStep: 5,
            radius: 20,
            octane: 'diesel',
        }),
        [['searchRadiusMiles', 20]]
    );

    assert.deepEqual(
        buildOnboardingPreferenceUpdates({
            currentStep: 6,
            radius: 20,
            octane: 'diesel',
        }),
        [['preferredOctane', 'diesel'], ['requiresE85', false]]
    );
});

test('onboarding translucency stays limited to the intended steps', () => {
    assert.equal(isTranslucentOnboardingStep(0), true);
    assert.equal(isTranslucentOnboardingStep(1), true);
    assert.equal(isTranslucentOnboardingStep(5), true);
    assert.equal(isTranslucentOnboardingStep(6), false);
});
