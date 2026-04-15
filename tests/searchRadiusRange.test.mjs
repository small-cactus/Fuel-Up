/**
 * Search-radius range regression guard.
 *
 * The `[MIN, MAX] = [2, 15]` mile range was determined empirically by
 * sweeping a cold launch at ~20 US locations (dense urban → extreme rural)
 * and recording how many GasBuddy-returned stations fall inside each
 * candidate filter radius. See the inline comment in
 * `src/lib/fuelSearchState.js` for the full rationale.
 *
 * This test pins the numbers so they cannot drift silently:
 *   - `normalizeSearchRadiusMiles` clamps to the [2, 15] range.
 *   - Legacy persisted values from the old [3, 25] slider snap into the
 *     new range (so an upgrading user's stored `25` becomes `15`, not a
 *     dangling 25 that has no slider notch).
 *   - The `RADIUS_OPTIONS` array in `app/(tabs)/settings.js` matches the
 *     validated range and has at least one value at each boundary.
 *   - Filter signatures stay stable across normalization (so two
 *     preferences that normalize to the same value also produce the same
 *     cache key).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_SEARCH_RADIUS_MILES,
    MAX_SEARCH_RADIUS_MILES,
    MIN_SEARCH_RADIUS_MILES,
    buildFuelSearchCriteriaSignature,
    normalizeFuelSearchPreferences,
    normalizeSearchRadiusMiles,
} from '../src/lib/fuelSearchState.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_PATH = path.join(REPO_ROOT, 'app', '(tabs)', 'settings.js');

test('MIN_SEARCH_RADIUS_MILES and MAX_SEARCH_RADIUS_MILES pin the validated range', () => {
    assert.equal(MIN_SEARCH_RADIUS_MILES, 2);
    assert.equal(MAX_SEARCH_RADIUS_MILES, 15);
    assert.ok(
        MIN_SEARCH_RADIUS_MILES <= DEFAULT_SEARCH_RADIUS_MILES &&
        DEFAULT_SEARCH_RADIUS_MILES <= MAX_SEARCH_RADIUS_MILES,
        `DEFAULT_SEARCH_RADIUS_MILES (${DEFAULT_SEARCH_RADIUS_MILES}) must be within [${MIN_SEARCH_RADIUS_MILES}, ${MAX_SEARCH_RADIUS_MILES}]`
    );
});

test('normalizeSearchRadiusMiles clamps small positive values to MIN', () => {
    // Positive values below the MIN snap up to MIN. After the 0.5 → 1 round.
    assert.equal(normalizeSearchRadiusMiles(0.5), MIN_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(1), MIN_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(1.9), MIN_SEARCH_RADIUS_MILES);
});

test('normalizeSearchRadiusMiles resolves non-positive values to DEFAULT (then clamped)', () => {
    // 0 and negative values are rejected by `toPositiveNumber` and fall
    // through to DEFAULT. DEFAULT is already inside [MIN, MAX] so the
    // clamp is a no-op.
    assert.equal(normalizeSearchRadiusMiles(0), DEFAULT_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(-5), DEFAULT_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(-999), DEFAULT_SEARCH_RADIUS_MILES);
});

test('normalizeSearchRadiusMiles clamps values above MAX to MAX', () => {
    assert.equal(normalizeSearchRadiusMiles(16), MAX_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(20), MAX_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(25), MAX_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(100), MAX_SEARCH_RADIUS_MILES);
});

test('normalizeSearchRadiusMiles preserves valid in-range values', () => {
    assert.equal(normalizeSearchRadiusMiles(2), 2);
    assert.equal(normalizeSearchRadiusMiles(3), 3);
    assert.equal(normalizeSearchRadiusMiles(5), 5);
    assert.equal(normalizeSearchRadiusMiles(10), 10);
    assert.equal(normalizeSearchRadiusMiles(15), 15);
});

test('normalizeSearchRadiusMiles rounds fractional values before clamping', () => {
    assert.equal(normalizeSearchRadiusMiles(2.4), 2);
    assert.equal(normalizeSearchRadiusMiles(2.6), 3);
    assert.equal(normalizeSearchRadiusMiles(14.4), 14);
    assert.equal(normalizeSearchRadiusMiles(14.6), 15);
    assert.equal(normalizeSearchRadiusMiles(14.9), 15);
});

test('normalizeSearchRadiusMiles coerces non-numeric input to the default', () => {
    assert.equal(normalizeSearchRadiusMiles(null), DEFAULT_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(undefined), DEFAULT_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles('abc'), DEFAULT_SEARCH_RADIUS_MILES);
    assert.equal(normalizeSearchRadiusMiles(NaN), DEFAULT_SEARCH_RADIUS_MILES);
});

test('normalizeFuelSearchPreferences snaps legacy stored radii into the new range', () => {
    // A user upgrading from the old [3, 5, 10, 15, 20, 25] slider could
    // have any of these persisted values. They must all resolve to a
    // slider notch in the new [2, 3, 5, 10, 15] range.
    const legacyValues = [3, 5, 10, 15, 20, 25];
    legacyValues.forEach(legacyValue => {
        const normalized = normalizeFuelSearchPreferences({
            searchRadiusMiles: legacyValue,
        });
        assert.ok(
            normalized.searchRadiusMiles >= MIN_SEARCH_RADIUS_MILES &&
            normalized.searchRadiusMiles <= MAX_SEARCH_RADIUS_MILES,
            `Legacy value ${legacyValue} should normalize into [${MIN_SEARCH_RADIUS_MILES}, ${MAX_SEARCH_RADIUS_MILES}], got ${normalized.searchRadiusMiles}`
        );
    });
    // Explicit mappings: the old max (25) must snap to the new max (15).
    assert.equal(
        normalizeFuelSearchPreferences({ searchRadiusMiles: 25 }).searchRadiusMiles,
        15
    );
    assert.equal(
        normalizeFuelSearchPreferences({ searchRadiusMiles: 20 }).searchRadiusMiles,
        15
    );
    // In-range legacy values stay unchanged.
    assert.equal(
        normalizeFuelSearchPreferences({ searchRadiusMiles: 3 }).searchRadiusMiles,
        3
    );
    assert.equal(
        normalizeFuelSearchPreferences({ searchRadiusMiles: 10 }).searchRadiusMiles,
        10
    );
});

test('buildFuelSearchCriteriaSignature collapses legacy radii to the clamped value', () => {
    const legacySignature = buildFuelSearchCriteriaSignature({
        preferredOctane: 'regular',
        searchRadiusMiles: 25,
        preferredProvider: 'gasbuddy',
        minimumRating: 0,
    });
    const clampedSignature = buildFuelSearchCriteriaSignature({
        preferredOctane: 'regular',
        searchRadiusMiles: 15,
        preferredProvider: 'gasbuddy',
        minimumRating: 0,
    });
    assert.equal(
        legacySignature,
        clampedSignature,
        'Legacy 25-mile radius must produce the same signature as the clamped 15-mile value'
    );
});

test('NativeSettingsForm wires the slider to MIN/MAX search radius constants', () => {
    // The settings screen now renders a native SwiftUI Slider that pulls
    // its bounds directly from `MIN_SEARCH_RADIUS_MILES` /
    // `MAX_SEARCH_RADIUS_MILES`, replacing the discrete `RADIUS_OPTIONS`
    // notch array. Pin those constants here so a future refactor can't
    // silently change the slider range.
    const NATIVE_FORM_PATH = path.join(
        REPO_ROOT,
        'src',
        'components',
        'settings',
        'NativeSettingsForm.js'
    );
    const source = fs.readFileSync(NATIVE_FORM_PATH, 'utf8');
    const importMatch = source.match(
        /import\s*\{([\s\S]*?)\}\s*from\s*'\.\.\/\.\.\/lib\/fuelSearchState'/
    );
    assert.ok(
        importMatch,
        'NativeSettingsForm must import from ../../lib/fuelSearchState'
    );
    const importNames = importMatch[1];
    assert.ok(
        importNames.includes('MIN_SEARCH_RADIUS_MILES'),
        'NativeSettingsForm must import MIN_SEARCH_RADIUS_MILES from fuelSearchState'
    );
    assert.ok(
        importNames.includes('MAX_SEARCH_RADIUS_MILES'),
        'NativeSettingsForm must import MAX_SEARCH_RADIUS_MILES from fuelSearchState'
    );
    assert.ok(
        /min=\{MIN_SEARCH_RADIUS_MILES\}/.test(source),
        'NativeSettingsForm Slider must use MIN_SEARCH_RADIUS_MILES as its `min` prop'
    );
    assert.ok(
        /max=\{MAX_SEARCH_RADIUS_MILES\}/.test(source),
        'NativeSettingsForm Slider must use MAX_SEARCH_RADIUS_MILES as its `max` prop'
    );
});
