const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

test('native station-core gate defers safely and preserves prompt claims', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-stop-evidence-'));
  try {
    const root = 'modules/fuel-up-driving-activity/ios/Research/';
    const binary = path.join(dir, 'run');
    execFileSync('swiftc', ['-parse-as-library', ...['DrivingResearchModels.swift',
      'DrivingResearchConfirmation.swift', 'DrivingResearchStopEvidence.swift'].map(f => root + f),
      'tests/swift/stopPromptEvidenceTests.swift', '-o', binary], {timeout: 60000, stdio: 'pipe'});
    process.stdout.write(execFileSync(binary, {timeout: 30000, encoding: 'utf8'}));
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

test('decision-time evidence round-trips through the existing research validator', async () => {
  const {validateDrivingEvents} = await import('../supabase/functions/_shared/drivingResearch.mjs');
  const now = Date.now() / 1000;
  const payload = {visitId: '11111111-1111-4111-8111-111111111111',
    stopPromptEvidence: {policy: 'station-stop-v3-core65', eligible: false,
      reason: 'outside_station_core', sampleCount: 10, spanSeconds: 60,
      coreRadiusMeters: 65, medianExpandedDistanceMeters: 80}};
  const rows = validateDrivingEvents([{id: '22222222-2222-4222-8222-222222222222',
    kind: 'diagnostic', recordedAt: now, payload: JSON.stringify(payload)}], now);
  assert.deepEqual(JSON.parse(rows[0].payload), payload);
});
