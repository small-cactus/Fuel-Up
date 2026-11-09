// Isolated PostgreSQL checks; no Supabase or provider connection.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { protectedReadSql } from './protectedRead.mjs';

const dir = mkdtempSync(join(tmpdir(), 'fuel-monitor-test-'));
let started = false;
const query = sql => execFileSync('psql', [
  '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-d', 'postgres', '-c', sql,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
try {
  execFileSync('initdb', ['-D', join(dir, 'data'), '-A', 'trust', '--no-locale'], { stdio: 'pipe' });
  execFileSync('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'),
    '-o', `-k ${dir} -c listen_addresses=''`, 'start'], { stdio: 'pipe' });
  started = true;
  query('create table protected_fixture(value integer); insert into protected_fixture values (42)');
  assert.equal(query(protectedReadSql('select value from protected_fixture;')).trim(), '42');
  assert.throws(() => query(protectedReadSql('select pg_sleep(2);', 50)),
    error => /statement timeout/.test(String(error.stderr)) && !error.signal);
  assert.throws(() => query(protectedReadSql('delete from protected_fixture;')),
    error => /read-only transaction/.test(String(error.stderr)));
  assert.equal(query('select value from protected_fixture;').trim(), '42');
  assert.throws(() => protectedReadSql('select 1;', '15; malicious'), RangeError);
  console.log('Passed: result preserved, server timeout cancels slow work, writes rejected, fixture intact.');
} finally {
  if (started) execFileSync('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', 'stop'], { stdio: 'pipe' });
  rmSync(dir, { recursive: true, force: true });
}
