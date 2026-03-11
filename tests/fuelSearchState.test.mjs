import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildFuelSearchCriteriaSignature,
    buildFuelSearchRequestKey,
    buildResolvedFuelSearchContext,
    normalizeFuelSearchPreferences,
} from '../src/lib/fuelSearchState.js';

test('normalizeFuelSearchPreferences preserves diesel and normalizes defaults', () => {
    const normalized = normalizeFuelSearchPreferences({
        preferredOctane: 'diesel',
        searchRadiusMiles: '15.4',
        preferredProvider: 'ALL',
        minimumRating: '4.5',
    });

    assert.deepEqual(normalized, {
        preferredOctane: 'diesel',
        searchRadiusMiles: 15,
        preferredProvider: 'all',
        minimumRating: 4.5,
    });
});

test('fuel search request keys change for location and every request-affecting preference', () => {
    const origin = { latitude: 37.3346, longitude: -122.009 };
    const baseKey = buildFuelSearchRequestKey({
        origin,
        fuelGrade: 'regular',
        radiusMiles: 10,
        preferredProvider: 'gasbuddy',
        minimumRating: 0,
    });

    assert.notEqual(baseKey, buildFuelSearchRequestKey({
        origin,
        fuelGrade: 'diesel',
        radiusMiles: 10,
        preferredProvider: 'gasbuddy',
        minimumRating: 0,
    }));
    assert.notEqual(baseKey, buildFuelSearchRequestKey({
        origin,
        fuelGrade: 'regular',
        radiusMiles: 25,
        preferredProvider: 'gasbuddy',
        minimumRating: 0,
    }));
    assert.notEqual(baseKey, buildFuelSearchRequestKey({
        origin,
        fuelGrade: 'regular',
        radiusMiles: 10,
        preferredProvider: 'all',
        minimumRating: 0,
    }));
    assert.notEqual(baseKey, buildFuelSearchRequestKey({
        origin,
        fuelGrade: 'regular',
        radiusMiles: 10,
        preferredProvider: 'gasbuddy',
        minimumRating: 4,
    }));
    assert.notEqual(baseKey, buildFuelSearchRequestKey({
        origin: { latitude: 37.3646, longitude: -122.009 },
        fuelGrade: 'regular',
        radiusMiles: 10,
        preferredProvider: 'gasbuddy',
        minimumRating: 0,
    }));
});

test('resolved fuel search context carries a full request key and criteria signature', () => {
    const context = buildResolvedFuelSearchContext({
        origin: {
            latitude: 37.3346,
            longitude: -122.009,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
        },
        locationSource: 'device',
        fuelGrade: 'diesel',
        radiusMiles: 15,
        preferredProvider: 'gasbuddy',
        minimumRating: 2.5,
    });

    assert.ok(context.requestKey.includes('diesel'));
    assert.equal(
        context.criteriaSignature,
        buildFuelSearchCriteriaSignature({
            fuelGrade: 'diesel',
            radiusMiles: 15,
            preferredProvider: 'gasbuddy',
            minimumRating: 2.5,
        })
    );
});
