import { describe, test, expect } from 'vitest';
import { resolveJobName } from './job-name.js';

describe('resolveJobName', () => {
  test.each([
    ['scan', 'scan'],
    ['train-spam', 'trainSpam'],
    ['train-ham', 'trainHam'],
    ['train-whitelist', 'trainWhitelist'],
    ['train-blacklist', 'trainBlacklist'],
  ] as const)('maps kebab job name %s to JobName %s', (kebab, jobName) => {
    expect(resolveJobName(kebab)).toEqual({ kind: 'jobName', jobName });
  });

  test('maps init-folders to the folder-init marker', () => {
    expect(resolveJobName('init-folders')).toEqual({ kind: 'initFolders' });
  });

  test('signals an unknown job name as unknown', () => {
    expect(resolveJobName('not-a-real-job')).toBe('unknown');
  });

  test('signals the empty string as unknown', () => {
    expect(resolveJobName('')).toBe('unknown');
  });
});
