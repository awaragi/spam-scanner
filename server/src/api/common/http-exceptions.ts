import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

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
  const match = /^(?:"(\d+)"|(\d+))$/.exec(raw.trim());
  if (!match) {
    throw new PreconditionRequiredException(
      'If-Match header must be a quoted version number, e.g. "3"',
    );
  }
  return parseInt(match[1] ?? match[2], 10);
}

/** The quote-wrapped `ETag` value for a given accounts-file version. */
export function etagFor(version: number): string {
  return `"${version}"`;
}

/**
 * Translates a `RunnerRegistry`/`MailboxRunner` plain `Error('Unknown
 * mailbox: ...')` to a `NotFoundException` a Nest exception filter can turn
 * into a 404. Shared by `AdminController` and `MailboxController` for every
 * synchronous `RunnerRegistry` lookup (`getMailboxStatus`/
 * `getMailboxSettings`/`enableMailbox`'s throw path, pre-lock).
 */
export function withUnknownMailboxAsNotFound<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Unknown mailbox:')
    ) {
      throw new NotFoundException(error.message);
    }
    throw error;
  }
}

/**
 * Same translation as `withUnknownMailboxAsNotFound`, for the `async`
 * `RunnerRegistry` methods (`triggerNow`/`triggerInitFolders`/
 * `updateSettings`/`enableMailbox`/`disableMailbox`), which reject rather
 * than throw synchronously.
 */
export async function withUnknownMailboxAsNotFoundAsync<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Unknown mailbox:')
    ) {
      throw new NotFoundException(error.message);
    }
    throw error;
  }
}
