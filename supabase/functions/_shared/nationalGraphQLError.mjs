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
    /^request to https?:\/\/\S+ failed, reason: (socket hang up|read ECONNRESET|connect (?:ECONNRESET|ETIMEDOUT)(?: \S+)?)$/i.test(message);
  if (messages.length && messages.every(transient) &&
      codes.every(code => ['', '408', '502', '503', '504', 'INTERNAL_SERVER_ERROR', 'ECONNRESET', 'ETIMEDOUT'].includes(code))) {
    return { code: 'UPSTREAM_TRANSIENT_GRAPHQL', retryAfterSeconds: Math.max(60, retryAfter) };
  }
  return { code: 'GRAPHQL_ERROR', retryAfterSeconds: retryAfter };
}

// The first ten errors can all be transient while a later error determines the
// batch outcome. Keep counts over the entire list and examples for each class.
// This is diagnostic only: classification and retry/access policy stay intact.
export function summarizeNationalGraphQLErrors(errors) {
  const classes = new Map(), extensionCodes = new Map();
  for (const error of errors) {
    const classification = classifyNationalGraphQLErrors([error]).code;
    const extensionCode = String(error?.extensions?.code || '').toUpperCase().slice(0, 100);
    extensionCodes.set(extensionCode, (extensionCodes.get(extensionCode) || 0) + 1);
    const entry = classes.get(classification) || { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 3) entry.examples.push({
      message: String(error?.message || '').slice(0, 500), extensionCode,
    });
    classes.set(classification, entry);
  }
  return { total: errors.length, classes: Object.fromEntries(classes),
    extensionCodes: Object.fromEntries(extensionCodes) };
}
