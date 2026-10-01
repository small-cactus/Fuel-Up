import { buildGasBuddyGraphQLRequest } from './core.mjs';
import { providerResponseEvidence } from './providerResponseEvidence.mjs';
import { priceQuery, validatePriceBatch } from './nationalPriceBatch.mjs';
import { classifyNationalGraphQLErrors } from './nationalGraphQLError.mjs';

export class NationalPriceError extends Error {
  constructor(code, retryAfterSeconds = 0) { super(code); this.code = code; this.retryAfterSeconds = retryAfterSeconds; }
}

export function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

export async function fetchNationalPriceBatch(ids, { fetchImpl = fetch, csrf, maxBytes = 8_000_000 } = {}) {
  if (!ids.length || ids.length > 2000) throw new NationalPriceError('INVALID_BATCH_SIZE');
  const startedAt = new Date().toISOString(), started = performance.now();
  const { url, headers } = buildGasBuddyGraphQLRequest({ latitude: 0, longitude: 0 });
  const response = await fetchImpl(url, { method: 'POST', headers: { ...headers, ...(csrf ? { gbcsrf: csrf } : {}) },
    body: JSON.stringify({ query: priceQuery(ids), variables: {} }), signal: AbortSignal.timeout(25000) });
  const responseEvidence = providerResponseEvidence(response, performance.now() - started);
  if (!response.ok) {
    await response.body?.cancel();
    const error = new NationalPriceError(`UPSTREAM_HTTP_${response.status}`, retryAfterSeconds(response.headers.get('retry-after')));
    error.responseEvidence = responseEvidence; throw error;
  }
  if (!response.body) throw new NationalPriceError('EMPTY_RESPONSE');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new NationalPriceError('BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  responseEvidence.decodedBodyBytes = size;
  responseEvidence.fullElapsedMs = Math.round(performance.now() - started);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new NationalPriceError('INVALID_JSON'); }
  if (body.errors?.length) {
    const classification = classifyNationalGraphQLErrors(body.errors, retryAfterSeconds(response.headers.get('retry-after')));
    const error = new NationalPriceError(classification.code, classification.retryAfterSeconds);
    error.responseEvidence = { ...responseEvidence, graphqlErrors: body.errors.map(e => String(e.message).slice(0, 500)).slice(0, 10) }; throw error; }
  let stations;
  try { stations = validatePriceBatch(body.data, ids); } catch { throw new NationalPriceError('COVERAGE_OR_SCHEMA_MISMATCH'); }
  return { version: 1, provider: 'gasbuddy', startedAt, observedAt: new Date().toISOString(), responseEvidence, stations };
}

export async function compressSnapshot(snapshot) {
  const stream = new Blob([JSON.stringify(snapshot)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
