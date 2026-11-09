import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDiagnostics, summarizeMetrics, failureKind } from '../scripts/national-prices/diagnostics.mjs';

test('database outage retains independent metrics and never reports full health', async () => {
  const result = await collectDiagnostics({
    metrics: async () => [{ name: 'node_load15', value: 12.24 }],
    query: () => { throw { stderr: 'unexpected status 544: connection timeout private detail' }; },
  });
  assert.equal(result.partial, true);
  assert.equal(result.providerRequests, 0);
  assert.equal(result.host.data[0].value, 12.24);
  assert.deepEqual(result.database, { ok: false, error: 'DATABASE_CONNECTION_TIMEOUT' });
  assert.ok(!JSON.stringify(result).includes('private detail'));
});

test('metrics failure does not discard readable run evidence', async () => {
  const result = await collectDiagnostics({
    metrics: () => { throw Error('secret-containing failure'); },
    query: () => ({ runs: [{ id: 1, status: 'partial' }] }),
  });
  assert.equal(result.host.ok, false);
  assert.equal(result.database.data.runs[0].status, 'partial');
  assert.ok(!JSON.stringify(result).includes('secret-containing'));
});

test('resource metrics accept scientific notation and discard unrelated labels and series', () => {
  assert.deepEqual(summarizeMetrics(`node_memory_MemTotal_bytes{private_label="omit"} 4.313088e+08
node_cpu_seconds_total{cpu="0",mode="iowait",private_label="omit"} 1.5e+05
unrelated_metric{email="omit"} 1`), [
    { name: 'node_memory_MemTotal_bytes', value: 431308800 },
    { name: 'node_cpu_seconds_total', cpu: '0', mode: 'iowait', value: 150000 },
  ]);
  assert.throws(() => summarizeMetrics('<html>Gateway failure</html>'));
});

test('timeout and metrics gateway failures retain their safe diagnostic category', () => {
  assert.equal(failureKind({ code: 'ETIMEDOUT', stderr: '' }), 'CLIENT_TIMEOUT');
  assert.equal(failureKind({ name: 'TimeoutError', message: 'private detail' }), 'CLIENT_TIMEOUT');
  assert.equal(failureKind(Error('Metrics HTTP 504')), 'METRICS_HTTP_504');
});
