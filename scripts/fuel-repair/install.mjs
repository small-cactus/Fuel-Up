import { cp, mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const source = dirname(fileURLToPath(import.meta.url));
const app = JSON.parse(await readFile(join(source, '../../app.json'), 'utf8')).expo.extra.supabase;
const root = join(homedir(), 'Library/Application Support/FuelUpRepair');
await mkdir(root, { recursive: true, mode: 0o700 });
await chmod(root, 0o700);
const configPath = join(root, 'config.json');
let existing;
try { existing = JSON.parse(await readFile(configPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const binaryRoot = dirname(process.execPath);
const config = { ...existing, secret: existing?.secret || randomBytes(32).toString('hex'),
  url: app.url, projectRef: new URL(app.url).hostname.split('.')[0],
  repository: 'https://github.com/small-cactus/Fuel-Up.git', node: process.execPath,
  npx: join(binaryRoot, 'npx'), codex: join(binaryRoot, 'codex'),
};
await access(config.codex);
await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
await chmod(configPath, 0o600);
for (const name of ['worker.mjs', 'policy.mjs']) await cp(join(source, name), join(root, name));
await writeFile(join(root, 'supabase-secrets.env'), `FUEL_REPAIR_SECRET=${config.secret}\n`, { mode: 0o600 });
execFileSync(config.npx, ['--yes', 'supabase@2.118.0', 'secrets', 'set', '--project-ref', config.projectRef,
  '--env-file', join(root, 'supabase-secrets.env')], { stdio: 'inherit' });
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const path = `${binaryRoot}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.fuelup.repair</string>
<key>ProgramArguments</key><array><string>${escape(config.node)}</string><string>${escape(join(root, 'worker.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>StartInterval</key><integer>300</integer><key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string><key>Umask</key><integer>63</integer>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(path)}</string><key>HOME</key><string>${escape(homedir())}</string></dict>
<key>StandardOutPath</key><string>${escape(join(root, 'worker.log'))}</string>
<key>StandardErrorPath</key><string>${escape(join(root, 'worker.log'))}</string>
</dict></plist>`;
const plistPath = join(homedir(), 'Library/LaunchAgents/com.fuelup.repair.plist');
await mkdir(dirname(plistPath), { recursive: true });
await writeFile(plistPath, plist);
const domain = `gui/${process.getuid()}`;
try { execFileSync('/bin/launchctl', ['bootout', `${domain}/com.fuelup.repair`], { stdio: 'ignore' }); } catch {}
execFileSync('/bin/launchctl', ['bootstrap', domain, plistPath], { stdio: 'inherit' });
console.log(`Installed repair worker at ${root}; checks the queue every 5 minutes while logged in and awake.`);
