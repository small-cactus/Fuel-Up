import { performance } from 'node:perf_hooks';
import { buildGasBuddyGraphQLRequest } from '../../supabase/functions/_shared/core.mjs';

const errorWithCode = (message, code) => Object.assign(new Error(message), { code });

export function createSnapshotRequest({ fetchImpl = fetch, timeoutMs = 30000, maxResponseBytes = 20000000 } = {}) {
  // Reuse the app's existing endpoint/header configuration; no credential storage.
  const { url, headers } = buildGasBuddyGraphQLRequest({ latitude: 0, longitude: 0 });
  return async (query, variables) => {
    const body = JSON.stringify({ query, variables });
    if (Buffer.byteLength(body) > 90000) throw errorWithCode('Query exceeds conservative 90 KB budget', 'PAYLOAD_TOO_LARGE');
    const started = performance.now(), startedAt = new Date().toISOString();
    const response = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
    const headersMs = performance.now() - started;
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403, 429].includes(response.status)) {
        throw errorWithCode(`Provider HTTP ${response.status}; stopped. Retry-After: ${response.headers.get('retry-after') || 'unspecified'}`, 'ACCESS_OR_RATE_DENIAL');
      }
      throw errorWithCode(`Provider HTTP ${response.status}`, response.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UPSTREAM_HTTP');
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maxResponseBytes) throw errorWithCode('Response exceeds bounded download budget', 'PAYLOAD_TOO_LARGE');
      chunks.push(chunk);
    }
    const receivedMs = performance.now() - started, parseStart = performance.now();
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const parseMs = performance.now() - parseStart;
    if (payload.errors?.length) {
      const messages = payload.errors.map(e => String(e.message));
      const tooLarge = messages.every(m => /request entity too large|payload too large/i.test(m));
      throw errorWithCode(messages.join('; '), tooLarge ? 'PAYLOAD_TOO_LARGE' : 'GRAPHQL_ERROR');
    }
    return { data: payload.data, metrics: { startedAt, observedAt: new Date().toISOString(),
      status: response.status, queryBytes: Buffer.byteLength(body), decodedBodyBytes: bytes,
      headersMs, receivedMs, parseMs } };
  };
}
