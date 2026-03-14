import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildOnboardingPreferenceUpdates,
    isTranslucentOnboardingStep,
    ONBOARDING_STEPS,
} from '../src/lib/onboardingFlow.js';

test('onboarding flow removes the rating step and keeps six steps', () => {
    assert.deepEqual(ONBOARDING_STEPS, [
        'welcome',
        'predictive',
        'location',
        'notifications',
        'radius',
        'octane',
    ]);
});

test('onboarding only commits radius and octane on their respective steps', () => {
    assert.deepEqual(
        buildOnboardingPreferenceUpdates({
            currentStep: 4,
            radius: 20,
            octane: 'diesel',
        }),
        [['searchRadiusMiles', 20]]
    );

    assert.deepEqual(
        buildOnboardingPreferenceUpdates({
            currentStep: 5,
            radius: 20,
            octane: 'diesel',
        }),
        [['preferredOctane', 'diesel']]
    );
});

test('onboarding translucency stays limited to the intended steps', () => {
    assert.equal(isTranslucentOnboardingStep(0), true);
    assert.equal(isTranslucentOnboardingStep(1), true);
    assert.equal(isTranslucentOnboardingStep(4), true);
    assert.equal(isTranslucentOnboardingStep(5), false);
});
