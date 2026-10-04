/** Turns an Angular `HttpErrorResponse`-shaped value into a human-readable
 * message, used everywhere a failed API call needs to be shown to the user
 * (never the raw error object - see specs/front-end/control-ui). */
export function httpErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err && typeof err === 'object') {
    const httpErr = err as { error?: unknown; message?: unknown };
    const body = httpErr.error;
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
      if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
        return message.join(', ');
      }
    }
    if (typeof body === 'string' && body.trim()) {
      return body;
    }
    if (typeof httpErr.message === 'string' && httpErr.message.trim()) {
      return httpErr.message;
    }
  }
  return fallback;
}
