import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeQuerySignature, buildHomeFilterSignature } from '../src/lib/homeState.js';
import { buildFuelSearchRequestKey, buildResolvedFuelSearchContext } from '../src/lib/fuelSearchState.js';

const request = {
    origin: { latitude: 27.9506, longitude: -82.4572 },
    radiusMiles: 10,
    fuelGrade: 'premium',
    preferredProvider: 'gasbuddy',
};

test('Home fetch identity changes when E85 inventory or preferred brands change', () => {
    const baseline = buildHomeQuerySignature(request);
    assert.notEqual(baseline, buildHomeQuerySignature({ ...request, requiresE85: true }));
    assert.notEqual(baseline, buildHomeQuerySignature({ ...request, preferredBrands: ['shell'] }));
    assert.equal(
        buildHomeQuerySignature({ ...request, requiresE85: true, preferredBrands: ['Shell', 'COSTCO'] }),
        buildHomeQuerySignature({ ...request, requiresE85: true, preferredBrands: ['costco', 'shell', 'shell'] }),
    );
});

test('Home filter identity and shared context retain both preferences and the displayed fuel grade', () => {
    const selected = { ...request, requiresE85: true, preferredBrands: ['shell'] };
    const context = buildResolvedFuelSearchContext(selected);
    assert.equal(buildHomeQuerySignature(selected), buildFuelSearchRequestKey(selected));
    assert.equal(buildHomeQuerySignature(selected), context.requestKey);
    assert.equal(buildHomeFilterSignature(selected), context.criteriaSignature);
    assert.notEqual(context.requestKey, buildHomeQuerySignature({ ...selected, fuelGrade: 'e85' }));
    assert.notEqual(buildHomeFilterSignature(request), buildHomeFilterSignature(selected));
});
