import { describe, test, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { writeReport } from '../../../src/lib/clients/report-file.client.ts';

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-file-client-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('writeReport', () => {
  test('creates the reports directory and writes the given text', async () => {
    const base = await makeTempDir();
    const reportsDir = path.join(base, 'reports');

    const filePath = await writeReport(
      reportsDir,
      'hello report',
      new Date('2026-01-01T12:00:00.000Z')
    );

    expect(filePath).toBe(path.join(reportsDir, '2026-01-01T12-00-00.txt'));
    expect(await fs.readFile(filePath, 'utf-8')).toBe('hello report');
  });

  test('two writes with different timestamps produce two distinct files', async () => {
    const base = await makeTempDir();
    const reportsDir = path.join(base, 'reports');

    const first = await writeReport(
      reportsDir,
      'first',
      new Date('2026-01-01T12:00:00.000Z')
    );
    const second = await writeReport(
      reportsDir,
      'second',
      new Date('2026-01-01T12:00:05.000Z')
    );

    expect(first).not.toBe(second);
    expect(await fs.readFile(first, 'utf-8')).toBe('first');
    expect(await fs.readFile(second, 'utf-8')).toBe('second');
  });
});
