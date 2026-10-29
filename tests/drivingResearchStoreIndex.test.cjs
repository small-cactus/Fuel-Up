const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('legacy research outboxes migrate to indexed recent-event reads without changing records', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'research-store-index-'));
  try {
    const root = 'modules/fuel-up-driving-activity/ios/Research/';
    const binary = path.join(folder, 'store-index');
    execFileSync('swiftc', ['-parse-as-library', root + 'DrivingResearchModels.swift',
      root + 'DrivingResearchStore.swift', 'tests/swift/drivingResearchStoreIndex.swift',
      '-lsqlite3', '-o', binary], { timeout: 60000, stdio: 'pipe' });
    const output = execFileSync(binary, { encoding: 'utf8', timeout: 120000 });
    assert.match(output, /PASS: populated legacy migration/);
    process.stdout.write(output);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
