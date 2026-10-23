const test = require('node:test');
const assert = require('node:assert/strict');
const { usesLegacyMapProbe, nativeMapProbeToken } = require('../src/screens/cluster-lab/mapProbeRoute.cjs');

test('standard iOS probe stays on native MapKit and forwards its token', () => {
    const params = { clusterProbe: '1', clusterProbeToken: 'native-check' };
    assert.equal(usesLegacyMapProbe(params, 'ios'), false);
    assert.equal(nativeMapProbeToken(params, true), 'native-check');
});
test('explicit legacy runner retains its original live map and cannot also start native probe', () => {
    const params = { clusterProbe: '1', legacyClusterProbe: '1', clusterProbeToken: 'legacy-check' };
    assert.equal(usesLegacyMapProbe(params, 'ios'), true);
    assert.equal(nativeMapProbeToken(params, true), null);
    assert.equal(usesLegacyMapProbe({}, 'android'), true);
});
test('existing native bookmarks work, and release cannot run debug fixtures', () => {
    assert.equal(nativeMapProbeToken({ clusterLabProbe: 'pair-check' }, true), 'pair-check');
    assert.equal(nativeMapProbeToken({ runClusterProbe: ['true'], probeToken: ['native-check'] }, true), 'native-check');
    assert.equal(nativeMapProbeToken({ clusterProbe: '0' }, true), null);
    assert.equal(nativeMapProbeToken({ clusterLabProbe: 'pair-check' }, false), null);
    assert.equal(nativeMapProbeToken({ clusterProbe: '1', clusterProbeToken: 'check' }, false), null);
});

test('native probe flags preserve route normalization for shared and repeated links', () => {
    for (const flag of ['on', ' TRUE ', ['0', 'yes'], true, 1]) {
        assert.equal(nativeMapProbeToken({ clusterProbe: flag, clusterProbeToken: 'check' }, true), 'check');
        assert.equal(usesLegacyMapProbe({ legacyClusterProbe: flag }, 'ios'), true);
    }
});
