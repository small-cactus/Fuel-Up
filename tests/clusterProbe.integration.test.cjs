const test = require('node:test');
const assert = require('node:assert/strict');

const {
    runClusterProbeIntegration,
} = require('../scripts/clusterProbeIntegration.cjs');

test('cluster probe integration keeps max frame movement at 0px', {
    timeout: 130000,
}, async () => {
    const {
        report,
        reportFilePath,
        token,
    } = await runClusterProbeIntegration({
        maxFrameDeltaThreshold: 0,
    });

    assert.equal(report.status, 'completed');
    assert.equal(report.trigger, `automation:${token}`);
    assert.ok(
        report.maxFrameDelta <= 0,
        `Expected maxFrameDelta <= 0px but received ${report.maxFrameDelta}px. Report: ${reportFilePath}`
    );
});
