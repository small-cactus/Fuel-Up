const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

test('motion bridge serializes live/history callbacks and ignores stopped stream generations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-motion-concurrency-'));
  const file = process.env.FUELUP_MOTION_TEST_SOURCE || 'modules/fuel-up-driving-activity/ios/FuelUpDrivingActivityModule.swift';
  const source = fs.readFileSync(file, 'utf8');
  // Compile the production motion fields, registrations and helpers unchanged.
  // Unrelated telemetry/view declarations require UIKit and are outside this test.
  const fields = source.slice(source.indexOf('  private let activityManager'), source.indexOf('  public func definition()'));
  const definitions = source.slice(source.indexOf('    AsyncFunction("getAuthorizationStatusAsync")'));
  const production = 'final class FuelUpDrivingActivityModule: Module {\n' + fields +
    '  func definition() -> ModuleDefinition {\n' + definitions;
  const stubs = fs.readFileSync('tests/swift/motionBridgeStubs.swift', 'utf8');
  const cases = fs.readFileSync('tests/swift/motionBridgeConcurrency.swift', 'utf8');
  try {
    const swift = path.join(directory, 'main.swift');
    const binary = path.join(directory, 'test');
    fs.writeFileSync(swift, stubs + '\n' + production + '\n' + cases);
    execFileSync('swiftc', ['-parse-as-library', '-g', '-sanitize=thread', swift, '-o', binary], {timeout: 60000});
    const output = execFileSync(binary, [], {timeout: 60000, encoding: 'utf8', env: {...process.env, TSAN_OPTIONS:'halt_on_error=1'}});
    console.log(output.trim());
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
});
