import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, open, readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairFiles, validateRepairPaths, incidentCode, deployWithRollback } from './policy.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
const log = message => console.log(`${new Date().toISOString()} ${message}`);
const endpoint = `${config.url}/functions/v1/fuel-repair`;
const active = new Set();
let leaseLost = false;
async function api(body) {
  const response = await fetch(endpoint, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'x-fuel-repair-secret': config.secret, 'x-region': 'us-east-2',
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Repair queue HTTP ${response.status}`);
  return response.json();
}
function run(command, args, { cwd = root, timeout = 120000, env = {}, input, output } = {}) {
  if (leaseLost) return Promise.reject(new Error('Repair lease lost'));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    active.add(child);
    let text = '';
    const consume = data => { if (output) output.write(data); text = (text + data.toString()).slice(-24000); };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    const timer = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), timeout);
    child.on('error', error => { clearTimeout(timer); active.delete(child); reject(error); });
    child.on('close', code => {
      clearTimeout(timer); active.delete(child);
      code === 0 ? resolve(text.trim()) : reject(new Error(`${command} exited ${code}: ${text.slice(-2000)}`));
    });
    child.stdin.end(input);
  });
}
const git = (cwd, ...args) => run('/usr/bin/git', args, { cwd });
const cli = (cwd, ...args) => run(config.npx, ['--yes', 'supabase@2.118.0', ...args], { cwd, timeout: 180000 });
const probe = (cwd, candidate = false) => run(config.node, ['scripts/probeFuelFunction.mjs', '--all-grades'], {
  cwd, timeout: 120000, env: { FUEL_FUNCTION_NAME: candidate ? 'gas-prices-candidate' : 'gas-prices' },
});
async function gate(cwd) {
  const paths = (await git(cwd, 'diff', '--name-only', 'HEAD')).split('\n').filter(Boolean);
  const untracked = (await git(cwd, 'ls-files', '--others', '--exclude-standard')).split('\n').filter(Boolean);
  validateRepairPaths([...paths, ...untracked]);
  for (const path of [...paths, ...untracked]) {
    if (!(await lstat(join(cwd, path))).isFile()) throw new Error('Only regular repair files are allowed');
  }
  await run(config.node, ['scripts/buildFuelFunctionShared.cjs'], { cwd });
  const additional = (await readdir(join(cwd, 'tests'))).filter(name => /^gasRepair\.[a-zA-Z0-9_-]+\.test\.mjs$/.test(name));
  await run(config.node, ['--test', 'tests/gasPricesFunction.test.mjs', 'tests/fuelDataContracts.test.cjs',
    'tests/priceValidation.test.cjs', ...additional.map(name => `tests/${name}`)], { cwd });
  await run(config.node, ['scripts/buildFuelFunctionShared.cjs', '--check'], { cwd });
}
async function repair(job) {
  if (!/^[a-f0-9-]{36}$/.test(job.id) || !Number.isInteger(job.attempts)) throw new Error('Invalid repair identity');
  const directory = join(root, 'jobs', `${job.id}-${job.attempts}`);
  await mkdir(directory, { recursive: true });
  const cwd = join(directory, 'repo');
  await run('/usr/bin/git', ['clone', '--depth', '1', '--branch', 'master', config.repository, cwd], { timeout: 300000 });
  const base = await git(cwd, 'rev-parse', 'HEAD');
  try {
    await probe(cwd);
    return { message: 'Provider recovered; live and cached prices pass for every grade', commit: base };
  } catch { /* A real failure still exists; diagnose it. */ }
  const branch = `repair/gasbuddy-${job.id}-${job.attempts}`;
  await git(cwd, 'switch', '-c', branch);
  const outputFile = await open(join(directory, 'codex.log'), 'a', 0o600);
  const output = outputFile.createWriteStream();
  try {
    await run(config.codex, ['exec', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"',
      '-c', 'web_search="live"', '--cd', cwd, '--color', 'never', '-'], {
      cwd, timeout: 25 * 60_000, output,
      input: `Repair Fuel Up's Supabase gas-prices function. A real provider incident persisted: ${incidentCode(job.code)}.
Research the current GasBuddy API behavior using primary sources, reproduce the failure, and fix the root cause.
GasBuddy is the only live provider. Preserve cache fill, price/grade validation and the version 1 response contract.
Edit only these files: ${[...repairFiles].join(', ')}. Add regression tests as tests/gasRepair.NAME.test.mjs.
Do not change existing tests, infrastructure, dependencies, credentials, security settings, or the repair worker.
Do not bypass provider access controls or CAPTCHAs. If credentials or access are required, explain that in your final report.
Run node scripts/buildFuelFunctionShared.cjs after changes to the CommonJS source files.
The supervising worker performs independent tests, commits, pushes, candidate deployment and production rollout. Leave your fix uncommitted; do not deploy, commit or push from this coding step.
Use the existing CLI model and credentials. Never print credentials. Finish with the diagnosis and evidence.`,
    });
  } finally { output.end(); }
  if (await git(cwd, 'rev-parse', 'HEAD') !== base) throw new Error('Coding step changed Git history');
  await gate(cwd);
  const paths = (await git(cwd, 'diff', '--name-only', 'HEAD')).split('\n').filter(Boolean);
  const added = (await git(cwd, 'ls-files', '--others', '--exclude-standard')).split('\n').filter(Boolean);
  await git(cwd, 'add', '--', ...paths, ...added);
  await git(cwd, 'commit', '-m', `Fix GasBuddy provider incident ${job.id}`);
  const commit = await git(cwd, 'rev-parse', 'HEAD');
  await git(cwd, 'push', 'origin', `HEAD:refs/heads/${branch}`);
  const remote = await git(cwd, 'ls-remote', 'origin', `refs/heads/${branch}`);
  if (!remote.startsWith(commit)) throw new Error('Repair backup push could not be verified');
  // Candidate probes read existing history but cannot populate production caches or incident counters.
  const candidate = join(cwd, 'supabase/functions/gas-prices-candidate');
  await mkdir(candidate, { recursive: true });
  const entry = await readFile(join(cwd, 'supabase/functions/gas-prices/index.ts'), 'utf8');
  const marker = 'getGasPrices({ input, db,';
  if (entry.split(marker).length !== 2) throw new Error('Candidate wrapper could not enable read-only probes');
  await writeFile(join(candidate, 'index.ts'), entry.replace(marker, `${marker} probeOnly: true,`));
  await cli(cwd, 'functions', 'deploy', 'gas-prices-candidate', '--project-ref', config.projectRef, '--use-api');
  await probe(cwd, true);
  const latest = await git(cwd, 'ls-remote', 'origin', 'refs/heads/master');
  if (!latest.startsWith(base)) throw new Error('Master changed during repair; saved branch requires a fresh retry');
  // Fast-forward only. A completed fix is on GitHub before production changes.
  await git(cwd, 'push', 'origin', 'HEAD:refs/heads/master');
  await deployWithRollback({
    deploy: () => cli(cwd, 'functions', 'deploy', 'gas-prices', '--project-ref', config.projectRef, '--use-api'),
    verify: () => probe(cwd),
    rollback: async () => {
      const rollback = join(directory, 'rollback');
      await run('/usr/bin/git', ['clone', '--no-hardlinks', cwd, rollback]);
      await git(rollback, 'checkout', base);
      await cli(rollback, 'functions', 'deploy', 'gas-prices', '--project-ref', config.projectRef, '--use-api');
      // Revert by a new commit; never rewrite remote history.
      await git(cwd, 'revert', '--no-edit', commit);
      await git(cwd, 'push', 'origin', 'HEAD:refs/heads/master');
    },
  });
  return { commit, branch, message: 'All grades passed candidate and production live/cache probes' };
}
async function main() {
  const { job } = await api({ action: 'claim' });
  if (!job) { log('Queue healthy; no repair pending'); return; }
  log(`Claimed repair ${job.id}, attempt ${job.attempts}`);
  const update = (status, result) => api({ action: 'update', id: job.id, token: job.lease_token, status, result });
  const heartbeat = setInterval(async () => {
    try { if (!(await update('running')).updated) throw new Error('Lease expired'); }
    catch { leaseLost = true; for (const child of active) process.kill(-child.pid, 'SIGKILL'); }
  }, 60000);
  try {
    const result = await repair(job);
    if (!(await update('succeeded', result)).updated) throw new Error('Repair result lease expired');
    log(`Repair ${job.id} succeeded: ${result.message}`);
  } catch (error) {
    log(`Repair ${job.id} failed: ${error.message}`);
    // Keep raw command output local. The server receives only a bounded summary.
    await update(job.attempts < 3 ? 'queued' : 'failed', { message: 'Repair did not pass all gates. Inspect Mac worker logs.', attempt: job.attempts }).catch(() => {});
    process.exitCode = 1;
  } finally { clearInterval(heartbeat); }
}
await main().catch(error => { log(error.message); process.exitCode = 1; });
