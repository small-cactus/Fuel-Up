// Explicit deployment step, never imported by the application.
import { readFile, writeFile, mkdir, mkdtemp, chmod, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const app = JSON.parse(await readFile('app.json', 'utf8')).expo.extra.supabase;
const ref = new URL(app.url).hostname.split('.')[0];
if (ref !== 'vjindchxfebaltbslqwc') throw new Error('Unexpected project; verify deployment target');
const directory = join(homedir(), 'Library/Application Support/FuelUpResearch');
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const configPath = join(directory, 'config.json');
let config;
try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
config ||= { projectRef: ref, campaignId: 'hourly-24-cities-20260930-v1', secret: randomBytes(32).toString('hex') };
if (config.projectRef !== ref) throw new Error('Stored configuration targets another project');
await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
await chmod(configPath, 0o600);
const temporary = await mkdtemp(join(tmpdir(), 'fuel-research-install-'));
await chmod(temporary, 0o700);
const cli = args => execFileSync('npx', ['--no-install', 'supabase', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
try {
    const secretPath = join(temporary, 'secrets.env');
    await writeFile(secretPath, `FUEL_RESEARCH_SECRET=${config.secret}\n`, { mode: 0o600 });
    cli(['secrets', 'set', '--project-ref', ref, '--env-file', secretPath]);
    const cities = JSON.parse(await readFile('scripts/price-model/collection-cities.json', 'utf8'));
    const sql = `begin;
do $$ declare existing uuid; begin
select id into existing from vault.secrets where name='fuel_research_secret';
if existing is null then perform vault.create_secret(${sqlString(config.secret)},'fuel_research_secret');
else perform vault.update_secret(existing,${sqlString(config.secret)}); end if;
select id into existing from vault.secrets where name='fuel_research_endpoint';
if existing is null then perform vault.create_secret(${sqlString(app.url + '/functions/v1/fuel-research')},'fuel_research_endpoint');
else perform vault.update_secret(existing,${sqlString(app.url + '/functions/v1/fuel-research')}); end if;
end $$;
select public.start_fuel_research(${sqlString(config.campaignId)},${sqlString(JSON.stringify(cities))}::jsonb);
do $$ begin
if exists(select 1 from public.fuel_research_campaigns where id=${sqlString(config.campaignId)} and status='active') then
perform cron.schedule('fuel-research-dispatch','* * * * *','select public.dispatch_fuel_research();');
perform cron.schedule('fuel-research-watchdog','*/5 * * * *','select public.watchdog_fuel_research();');
end if;
end $$;
commit;
select * from public.fuel_research_health where id=${sqlString(config.campaignId)};`;
    const sqlPath = join(temporary, 'configure.sql');
    await writeFile(sqlPath, sql, { mode: 0o600 });
    const result = cli(['db', 'query', '--linked', '--project-ref', ref, '--file', sqlPath, '--output', 'json']);
    // SQL returns health/counts only, never the Vault values.
    console.log(result);
} catch (error) {
    // SQL diagnostics can echo a statement: never print them while it contains a credential.
    console.error('Collection installation failed; protected diagnostics were not printed. Exit status:', error.status ?? 'unknown');
    process.exitCode = 1;
} finally {
    await rm(temporary, { recursive: true, force: true });
}
