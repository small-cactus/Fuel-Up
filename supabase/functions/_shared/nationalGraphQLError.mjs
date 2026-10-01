// Classify the entire error list before truncating diagnostic messages. A mixed
// response must never hide an access/rate denial behind a transient first error.
export function classifyNationalGraphQLErrors(errors, retryAfter = 0) {
  const messages = errors.map(error => String(error?.message || '').trim());
  const codes = errors.map(error => String(error?.extensions?.code || '').toUpperCase());
  if (messages.some(message => /unauthori[sz]ed|forbidden|access denied|\b40[13]\b/i.test(message)) ||
      codes.some(code => ['401', '403', 'UNAUTHENTICATED', 'UNAUTHORIZED', 'FORBIDDEN'].includes(code))) {
    return { code: 'UPSTREAM_HTTP_403', retryAfterSeconds: retryAfter };
  }
  if (messages.some(message => /rate.?limit|too many requests|\b429\b/i.test(message)) ||
      codes.some(code => ['429', 'TOO_MANY_REQUESTS', 'RATE_LIMITED', 'RATE_LIMIT_EXCEEDED'].includes(code))) {
    return { code: 'UPSTREAM_HTTP_429', retryAfterSeconds: retryAfter };
  }
  const transient = message => /^(408|502|503|504)$/.test(message) ||
    /^(socket hang up|ECONNRESET|ETIMEDOUT|request timed out|gateway timeout)$/i.test(message) ||
    /^request to https?:\/\/\S+ failed, reason: (socket hang up|read ECONNRESET|connect ETIMEDOUT(?: \S+)?)$/i.test(message);
  if (messages.length && messages.every(transient) &&
      codes.every(code => ['', '408', '502', '503', '504', 'INTERNAL_SERVER_ERROR', 'ECONNRESET', 'ETIMEDOUT'].includes(code))) {
    return { code: 'UPSTREAM_TRANSIENT_GRAPHQL', retryAfterSeconds: Math.max(60, retryAfter) };
  }
  return { code: 'GRAPHQL_ERROR', retryAfterSeconds: retryAfter };
}
