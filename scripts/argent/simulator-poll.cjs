// Bound only Argent's background simulator inventory probe, including children
// started by Apple's simctl first-launch wrapper. Never kill by process name.
const { spawn } = require('node:child_process');
function runBoundedProbe(command, args, { timeoutMs = 8000, killGraceMs = 500, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, { detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', bytes = 0, failure, settled = false, escalation;
    const signal = value => {
      if (!child.pid) return;
      try { grouped ? process.kill(-child.pid, value) : child.kill(value); }
      catch (error) { if (error.code !== 'ESRCH') failure ||= error; }
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      error ? reject(error) : resolve(value);
    };
    const abort = error => {
      if (failure || settled) return;
      failure = error;
      signal('SIGTERM');
      // A wrapper may exit before its child; always finish group cleanup.
      escalation = setTimeout(() => {
        signal('SIGKILL');
        finish(failure);
      }, killGraceMs);
    };
    const deadline = setTimeout(() => abort(new Error('Simulator inventory probe timed out')), timeoutMs);
    child.on('error', error => finish(error));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) abort(new Error('Simulator inventory output exceeded limit'));
      else stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) abort(new Error('Simulator inventory output exceeded limit'));
    });
    child.on('close', (code, sig) => {
      if (failure) return;
      finish(code === 0 ? null : new Error(`Simulator inventory exited ${code ?? sig}`), { stdout });
    });
  });
}
function guardSimulatorPoll(poll, onError = () => {}) {
  let pending = null, failed = false;
  return (...args) => {
    if (failed) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve().then(() => poll(...args)).catch(error => {
      // A failed background probe must not repeatedly invoke Xcode setup.
      // Restart the tool server after fixing simulator prerequisites to retry.
      failed = true;
      onError(error);
    }).finally(() => { pending = null; });
    return pending;
  };
}
module.exports = { runBoundedProbe, guardSimulatorPoll };
