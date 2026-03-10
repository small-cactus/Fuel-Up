import test from 'node:test';
import assert from 'node:assert/strict';

import {
    canTriggerHomeLaunchReveal,
    shouldRevealDuringInitialHomeFit,
    shouldDelayHomeLaunchReveal,
} from '../src/lib/homeLaunch.js';

test('first uncached launch defers the home reveal until visual bootstrap finishes', () => {
    assert.equal(shouldDelayHomeLaunchReveal({
        usesLaunchBootstrap: true,
        hasCachedRegion: false,
        hasManualLocationOverride: false,
    }), true);
});

test('cached or manual launches keep the fast home reveal path', () => {
    assert.equal(shouldDelayHomeLaunchReveal({
        usesLaunchBootstrap: true,
        hasCachedRegion: true,
        hasManualLocationOverride: false,
    }), false);
    assert.equal(shouldDelayHomeLaunchReveal({
        usesLaunchBootstrap: true,
        hasCachedRegion: false,
        hasManualLocationOverride: true,
    }), false);
    assert.equal(shouldDelayHomeLaunchReveal({
        usesLaunchBootstrap: false,
        hasCachedRegion: false,
        hasManualLocationOverride: false,
    }), false);
});

test('home reveal only starts after the launch visual state is ready', () => {
    assert.equal(canTriggerHomeLaunchReveal({
        hasTriggeredInitialReveal: false,
        hasCompletedRootReveal: false,
        isFocused: true,
        isMapLoaded: true,
        isLaunchVisualReady: false,
    }), false);
    assert.equal(canTriggerHomeLaunchReveal({
        hasTriggeredInitialReveal: false,
        hasCompletedRootReveal: false,
        isFocused: true,
        isMapLoaded: true,
        isLaunchVisualReady: true,
    }), true);
});

test('first uncached launch can reveal during the initial animated fit instead of after a pop', () => {
    assert.equal(shouldRevealDuringInitialHomeFit({
        isFirstLaunchWithoutCachedRegion: true,
        hasTriggeredInitialReveal: false,
        isLaunchCriticalFitPending: true,
        shouldAnimateInitialFit: true,
    }), true);
    assert.equal(shouldRevealDuringInitialHomeFit({
        isFirstLaunchWithoutCachedRegion: true,
        hasTriggeredInitialReveal: false,
        isLaunchCriticalFitPending: true,
        shouldAnimateInitialFit: false,
    }), false);
});
