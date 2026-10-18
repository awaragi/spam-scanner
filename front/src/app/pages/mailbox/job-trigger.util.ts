export type KebabJobName =
  'scan' | 'train-spam' | 'train-ham' | 'train-whitelist' | 'train-blacklist' | 'init-folders';

/** The five jobs the server tracks per-job running state for - `init-folders`
 * is bootstrap work triggered separately and has no tracked status (see
 * server's `job-name.ts`). */
type TrackedJobName = 'scan' | 'trainSpam' | 'trainHam' | 'trainWhitelist' | 'trainBlacklist';

const TRACKED_JOB_BY_KEBAB: Readonly<Partial<Record<KebabJobName, TrackedJobName>>> = {
  scan: 'scan',
  'train-spam': 'trainSpam',
  'train-ham': 'trainHam',
  'train-whitelist': 'trainWhitelist',
  'train-blacklist': 'trainBlacklist',
};

export interface JobStatusLike {
  status: 'idle' | 'running';
}

export type JobsStatus = Partial<Record<TrackedJobName, JobStatusLike>>;

/** Whether a job's own trigger control should be disabled because that job
 * is currently running (specs/front-end/control-ui). `init-folders` has no
 * tracked status and is never disabled this way. */
export function isJobTriggerDisabled(job: KebabJobName, jobs: JobsStatus | undefined): boolean {
  const tracked = TRACKED_JOB_BY_KEBAB[job];
  if (!tracked || !jobs) {
    return false;
  }
  return jobs[tracked]?.status === 'running';
}
