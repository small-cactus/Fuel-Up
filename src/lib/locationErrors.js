// Core Location's locationUnknown (0) means there is no fix yet. Keep the
// subscription alive and wait for its next update; this is not a task failure.
export function isTransientLocationUnavailable(error) {
    const message = String(error?.message || '');
    return /kCLErrorDomain/.test(message) && (
        error?.code === 0 || /\bCode=0\b/.test(message)
    );
}
