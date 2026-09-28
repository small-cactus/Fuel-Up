import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverviewCoordinates, cameraTargetChanged, homeMapPadding } from '../src/screens/home/mapCamera.js';
test('fit bounds include the user and every station, discarding invalid locations', () => {
    const points = buildOverviewCoordinates([{ latitude: 28, longitude: -82 }, { latitude: null, longitude: 0 }], { latitude: 27.9, longitude: -82.1 });
    assert.deepEqual(points, [{ latitude: 28, longitude: -82 }, { latitude: 27.9, longitude: -82.1 }]);
});
test('unchanged targets and GPS jitter do not restart native animation', () => {
    const a = { latitude: 28, longitude: -82, stationSignature: 'a', paddingSignature: 'a' };
    assert.equal(cameraTargetChanged(a, { ...a }), false);
    assert.equal(cameraTargetChanged(a, { ...a, latitude: 28.00001 }), false);
    assert.equal(cameraTargetChanged(a, { ...a, latitude: 28.001 }), true);
    assert.equal(cameraTargetChanged(a, { ...a, stationSignature: 'b' }), true);
});
test('camera padding reserves measured cards, tab bar and header', () => {
    for (const width of [320, 375, 440]) {
        const p = homeMapPadding({ topInset: 62, bottomInset: 34, cardHeight: 180, width });
        assert.ok(p.bottom >= 34 + 60 + 180);
        assert.ok(p.top >= 62 + 72);
        assert.ok(p.left >= 48);
    }
});
