import type { JobName } from '../../runtime/mailbox-runner.js';

/** The kebab-case route segment names `POST .../jobs/:job/trigger` accepts. */
export type KebabJobName =
  | 'scan'
  | 'train-spam'
  | 'train-ham'
  | 'train-whitelist'
  | 'train-blacklist'
  | 'init-folders';

/**
 * `triggerNow`'s five coalesced `JobName`s, mapped from their kebab route
 * name. `init-folders` is deliberately excluded here - it is bootstrap
 * work triggered through `RunnerRegistry.triggerInitFolders`, not one of
 * the five `JobName`s `triggerNow` accepts (design.md D6).
 */
const JOB_NAME_BY_KEBAB: Readonly<Record<string, JobName>> = {
  scan: 'scan',
  'train-spam': 'trainSpam',
  'train-ham': 'trainHam',
  'train-whitelist': 'trainWhitelist',
  'train-blacklist': 'trainBlacklist',
};

/** A resolved job-trigger route target - either a `JobName` for `triggerNow`, or the folder-init marker. */
export type ResolvedJob =
  | { kind: 'jobName'; jobName: JobName }
  | { kind: 'initFolders' };

/**
 * Maps a kebab-case route segment to its runner operation (design.md D6):
 * one of the five `JobName`s (`triggerNow`), the `init-folders` marker
 * (`triggerInitFolders`), or `'unknown'` for anything else - the caller
 * (`MailboxController`) turns `'unknown'` into a `BadRequestException`.
 */
export function resolveJobName(kebab: string): ResolvedJob | 'unknown' {
  if (kebab === 'init-folders') {
    return { kind: 'initFolders' };
  }

  const jobName = JOB_NAME_BY_KEBAB[kebab];
  if (!jobName) {
    return 'unknown';
  }

  return { kind: 'jobName', jobName };
}
