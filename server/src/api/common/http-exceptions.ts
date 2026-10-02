import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 428 Precondition Required - the `server/mailbox-accounts` spec's
 * "The server SHALL reject a mutation without `If-Match` with status 428"
 * requirement. `@nestjs/common` has no built-in exception for this status
 * (unlike `ConflictException`'s 409), so it's a thin `HttpException`
 * subclass here.
 */
export class PreconditionRequiredException extends HttpException {
  constructor(message = 'If-Match header is required') {
    super(
      { statusCode: HttpStatus.PRECONDITION_REQUIRED, message },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
}

/**
 * Reads and parses the `If-Match` header into the version number it
 * encodes - the quote-wrapped file version from the caller's last read
 * (design.md D3). Throws `PreconditionRequiredException` when the header is
 * missing or not shaped like a quoted integer.
 */
export function requireIfMatchVersion(
  header: string | string[] | undefined,
): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw.trim() === '') {
    throw new PreconditionRequiredException();
  }
  const match = /^"?(\d+)"?$/.exec(raw.trim());
  if (!match) {
    throw new PreconditionRequiredException(
      'If-Match header must be a quoted version number, e.g. "3"',
    );
  }
  return parseInt(match[1], 10);
}

/** The quote-wrapped `ETag` value for a given accounts-file version. */
export function etagFor(version: number): string {
  return `"${version}"`;
}
