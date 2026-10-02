import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNationalGraphQLErrors as classify } from '../supabase/functions/_shared/nationalGraphQLError.mjs';
import { fetchNationalPriceBatch } from '../supabase/functions/_shared/nationalPriceTransport.mjs';
const transient = { message: 'request to http://poi-serv:8000/v2/station/203865 failed, reason: socket hang up' };
const connectionReset = {
  message: 'request to http://poi-serv:8000/v2/station/49579 failed, reason: connect ECONNRESET 172.23.238.89:8000',
  extensions: { code: 'INTERNAL_SERVER_ERROR' },
};

test('provider connect resets retry but never conceal a mixed denial or unknown error', () => {
  assert.deepEqual(classify([connectionReset], 120), { code: 'UPSTREAM_TRANSIENT_GRAPHQL', retryAfterSeconds: 120 });
  for (const [message, expected] of [['forbidden', 'UPSTREAM_HTTP_403'], ['too many requests', 'UPSTREAM_HTTP_429'], ['unknown failure', 'GRAPHQL_ERROR']]) {
    assert.equal(classify([connectionReset, { message }]).code, expected);
  }
});

test('partial data with a connect reset is rejected without an immediate second request', async () => {
  let calls = 0;
  await assert.rejects(fetchNationalPriceBatch(['49579'], { fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ data: { s0: null }, errors: [connectionReset] }));
  } }), error => error.code === 'UPSTREAM_TRANSIENT_GRAPHQL' &&
    error.responseEvidence.graphqlErrorSummary.classes.UPSTREAM_TRANSIENT_GRAPHQL.count === 1);
  assert.equal(calls, 1);
});

test('known provider connection failures retry with a floor and respect longer Retry-After', () => {
  for (const message of [transient.message, '408', 'socket hang up', 'ETIMEDOUT']) {
    assert.deepEqual(classify([{ message }]), { code: 'UPSTREAM_TRANSIENT_GRAPHQL', retryAfterSeconds: 60 });
    assert.equal(classify([{ message }], 7200).retryAfterSeconds, 7200);
  }
});
test('denials anywhere in a large mixed list dominate transient classification', () => {
  const errors = Array.from({ length: 20 }, () => transient);
  for (const denied of [{ message: 'rate limited' }, { message: '408', extensions: { code: 'RATE_LIMITED' } }]) {
    assert.equal(classify([...errors, denied]).code, 'UPSTREAM_HTTP_429');
  }
  assert.equal(classify([...errors, { message: 'forbidden' }]).code, 'UPSTREAM_HTTP_403');
  assert.equal(classify([{ message: 'rate limited' }, { message: 'forbidden' }]).code, 'UPSTREAM_HTTP_403');
  assert.equal(classify([...errors, { message: '408', extensions: { code: 'UNAUTHENTICATED' } }]).code, 'UPSTREAM_HTTP_403');
});
test('unknown or malformed GraphQL failures retain review requirement', () => {
  for (const errors of [[{ message: 'unknown failure' }], [transient, {}], [{ message: '408', extensions: { code: 'NEW_DENIAL' } }]]) {
    assert.equal(classify(errors).code, 'GRAPHQL_ERROR');
  }
});
test('transport rejects partial data, records original evidence, and does not retry internally', async () => {
  let calls = 0;
  await assert.rejects(fetchNationalPriceBatch(['203865'], { fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ data: { s0: null }, errors: [transient] }), { headers: { 'retry-after': '120' } });
  } }), error => error.code === 'UPSTREAM_TRANSIENT_GRAPHQL' && error.retryAfterSeconds === 120 &&
    error.responseEvidence.graphqlErrors[0] === transient.message);
  assert.equal(calls, 1);
});
test('HTTP 200 rate denial preserves Retry-After', async () => {
  await assert.rejects(fetchNationalPriceBatch(['1'], { fetchImpl: async () => new Response(JSON.stringify({ errors: [{ message: 'too many requests' }] }), { headers: { 'retry-after': '7200' } }) }),
    error => error.code === 'UPSTREAM_HTTP_429' && error.retryAfterSeconds === 7200);
});

test('diagnostics retain the deciding error beyond the first ten without changing retry policy', async () => {
  for (const [last, expected] of [
    [{ message: 'unknown schema failure', extensions: { code: 'SCHEMA_ERROR' } }, 'GRAPHQL_ERROR'],
    [{ message: 'forbidden' }, 'UPSTREAM_HTTP_403'],
    [{ message: 'too many requests' }, 'UPSTREAM_HTTP_429'],
  ]) {
    let calls = 0;
    await assert.rejects(fetchNationalPriceBatch(['1'], { fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ errors: [...Array(2000).fill(transient), last] }));
    } }), error => {
      assert.equal(error.code, expected);
      const summary = error.responseEvidence.graphqlErrorSummary;
      assert.equal(summary.total, 2001);
      assert.equal(summary.classes.UPSTREAM_TRANSIENT_GRAPHQL.count, 2000);
      assert.equal(summary.classes.UPSTREAM_TRANSIENT_GRAPHQL.examples.length, 3);
      assert.equal(summary.classes[expected].count, 1);
      assert.equal(summary.classes[expected].examples[0].message, last.message);
      assert.equal(error.responseEvidence.graphqlErrors.length, 10);
      return true;
    });
    assert.equal(calls, 1);
  }
});
