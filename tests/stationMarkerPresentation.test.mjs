import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStationMarkerViewTrackingSignature,
} from '../src/cluster/stationMarkerPresentation.js';

function buildSignature(overrides = {}) {
  return buildStationMarkerViewTrackingSignature({
    quote: {
      stationId: 'station-a',
      price: 3.19,
    },
    isBest: false,
    isActive: false,
    isDark: false,
    useOnboardingColors: false,
    ...overrides,
  });
}

test('station marker view tracking signature ignores suppression-only changes', () => {
  const baseSignature = buildSignature();

  assert.equal(buildSignature({
    isSuppressed: true,
    shouldDelaySuppression: true,
    isContentHidden: true,
  }), baseSignature);
});

test('station marker view tracking signature changes for rendered content and theme updates', () => {
  const baseSignature = buildSignature();

  assert.notEqual(buildSignature({
    quote: {
      stationId: 'station-a',
      price: 3.29,
    },
  }), baseSignature);
  assert.notEqual(buildSignature({ isActive: true }), baseSignature);
  assert.notEqual(buildSignature({ isDark: true }), baseSignature);
  assert.notEqual(buildSignature({ useOnboardingColors: true }), baseSignature);
});
