const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runBoundedProbe, guardSimulatorPoll } = require('../scripts/argent/simulator-poll.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('successful inventory returns captured JSON', async () => {
  const r = await runBoundedProbe(process.execPath, ['-e', 'console.log(JSON.stringify({devices:{}}))']);
  assert.deepEqual(JSON.parse(r.stdout), { devices: {} });
});
test('overlapping ticks share one probe and failures latch background polling off', async () => {
  let count = 0, finish, errors = 0;
  const run = guardSimulatorPoll(() => { count++; return new Promise((resolve, reject) => { finish = reject; }); }, () => { errors++; });
  const first = run();
  await delay(0);
  const others = Array.from({ length: 100 }, () => run());
  assert.equal(count, 1);
  finish(new Error('Xcode setup blocked'));
  await Promise.all([first, ...others]);
  await run();
  assert.equal(count, 1);
  assert.equal(errors, 1);
});
test('successful ticks can run again after settling', async () => {
  let count = 0;
  const run = guardSimulatorPoll(async () => { count++; });
  await run(); await run();
  assert.equal(count, 2);
});
test('deadline removes wrapper and TERM-resistant descendant', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'argent-poll-test-'));
  const pidFile = join(dir, 'pid');
  let pid;
  try {
    const descendant = `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
    const wrapper = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
    await assert.rejects(runBoundedProbe(process.execPath, ['-e', wrapper], { timeoutMs: 1000, killGraceMs: 100 }), /timed out/);
    pid = Number(readFileSync(pidFile, 'utf8'));
    let gone = false;
    for (let i = 0; i < 30; i++) {
      try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') { gone = true; break; } throw e; }
      await delay(100);
    }
    assert.equal(gone, true, 'descendant must not survive timeout');
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    rmSync(dir, { recursive: true, force: true });
  }
});
test('failed spawn and excessive output reject', async () => {
  await assert.rejects(runBoundedProbe('/no-such-argent-probe', []), /ENOENT/);
  await assert.rejects(runBoundedProbe(process.execPath, ['-e', "console.log('x'.repeat(1024));setInterval(()=>{},1000)"], { maxBytes: 16, killGraceMs: 20 }), /exceeded limit/);
});
