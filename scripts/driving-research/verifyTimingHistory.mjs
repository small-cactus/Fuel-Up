// Synthetic enrolled fixture only. Verify existing server compatibility and erase it.
import assert from 'node:assert/strict';
import {randomUUID, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const participantId = randomUUID(), token = randomBytes(32).toString('hex');
const now = Date.now() / 1000;
const query = sql => JSON.parse(execFileSync('npx', ['--no-install', 'supabase@2.118.0', 'db', 'query', '--linked', '--project-ref', 'vjindchxfebaltbslqwc', sql, '--output', 'json'], {encoding: 'utf8'})).rows;
async function post(action, fields = {}) {
  const response = await fetch('https://vjindchxfebaltbslqwc.supabase.co/functions/v1/driving-research', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'x-research-token': token},
    body: JSON.stringify({action, participantId, ...fields}), signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
const events = ['available', 'query_failed'].map(status => ({
  id: randomUUID(), kind: 'diagnostic', recordedAt: now,
  payload: JSON.stringify({validationFixture: 'timing-history-smoke', schemaVersion: 1,
    timingContextVersion: 1, deviceTimeZone: 'UTC', receiptUTCOffsetSeconds: 0, appStateAtReceipt: 2,
    source: 'apple_motion_history', timingHistoryVersion: 1, queryStartAt: now-1200, queryEndAt: now-180,
    expiredHistorySeconds: 0, status, ...(status === 'available' ? {
      chunkIndex: 0, chunkCount: 1, activities: [{timestamp: now-600, automotive: true, stationary: false,
        walking: false, running: false, cycling: false, unknown: false, confidence: 2}],
    } : {timedOut: true}),
  }),
}));
try {
  await post('enroll', {consentVersion: 1});
  for (let i=0; i<2; i++) {
    const result = await post('upload', {events});
    assert.deepEqual(result.ids, events.map(e => e.id));
  }
  const rows = query(`select event from driving_research_events where participant_id='${participantId}'`);
  assert.equal(rows.length, events.length);
  for (const event of events) assert.deepEqual(rows.find(r => r.event.id === event.id).event, event);
  console.log('PASS: timing context and available/failed history accepted, immutable read-back, retry deduplication');
} finally {
  await post('delete');
  assert.equal(Number(query(`select count(*) as n from driving_research_events where participant_id='${participantId}'`)[0].n), 0);
  console.log('PASS: synthetic timing fixture erased');
}
