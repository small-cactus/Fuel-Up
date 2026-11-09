// Bound work on the server, even if the CLI disconnects before receiving a result.
export function protectedReadSql(sql, timeoutMs = 15000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new RangeError('Read timeout must be between 1 and 30000 milliseconds');
  }
  // One simple-query message runs in an implicit transaction. Keep SELECT last
  // so CLI clients return its rows, and let PostgreSQL commit the read on return.
  return `set transaction read only; set local statement_timeout='${timeoutMs}ms'; set local lock_timeout='1000ms';\n${sql}`;
}
