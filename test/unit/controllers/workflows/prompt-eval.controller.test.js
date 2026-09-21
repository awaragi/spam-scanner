import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.js';

vi.mock('../../../../src/lib/clients/eml-dataset.client.js', () => ({
  loadEmlDataset: vi.fn(),
}));
vi.mock('../../../../src/lib/clients/ai.client.js', () => ({
  classifyEmail: vi.fn(),
}));
vi.mock('../../../../src/lib/clients/report-file.client.js', () => ({
  writeReport: vi.fn(),
}));

import { runPromptEval } from '../../../../src/lib/controllers/workflows/prompt-eval.controller.js';
import { loadEmlDataset } from '../../../../src/lib/clients/eml-dataset.client.js';
import { classifyEmail } from '../../../../src/lib/clients/ai.client.js';
import { writeReport } from '../../../../src/lib/clients/report-file.client.js';

function makeMessage(bucket, filename) {
  return {
    bucket,
    filename,
    uid: `${bucket}/${filename}`,
    envelope: {
      from: [{ address: 'sender@example.com' }],
      subject: '',
      date: new Date(),
    },
    raw: `From: sender@example.com\r\n\r\nBody`,
  };
}

describe('runPromptEval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeReport.mockResolvedValue('.temp/reports/2026-01-01T00-00-00.txt');
  });

  test('wires load -> classify -> format -> write in order and returns the report path', async () => {
    loadEmlDataset.mockResolvedValue({
      bucketNames: ['ham', 'marketing', 'spam'],
      messages: [makeMessage('ham', 'a.eml'), makeMessage('spam', 'b.eml')],
    });
    classifyEmail.mockResolvedValue({ score: 10, reasoning: 'ok' });

    const ctx = fixtureContext({
      config: { AI_MODEL: 'gpt-4o-mini', AI_MAX_OUTPUT_TOKENS: 2000 },
    });

    const bucketPaths = {
      ham: '.temp/messages/ham',
      marketing: '.temp/messages/marketing',
      spam: '.temp/messages/spam',
    };
    const result = await runPromptEval(
      { bucketPaths, reportsDir: '.temp/reports' },
      ctx
    );

    expect(loadEmlDataset).toHaveBeenCalledWith(bucketPaths);
    expect(classifyEmail).toHaveBeenCalledTimes(2);
    expect(writeReport).toHaveBeenCalledTimes(1);
    const [reportsDir, reportText] = writeReport.mock.calls[0];
    expect(reportsDir).toBe('.temp/reports');
    expect(reportText).toContain('== ham (1) ==');
    expect(reportText).toContain('== marketing (0) ==');
    expect(reportText).toContain('== spam (1) ==');
    expect(reportText).toContain('model: gpt-4o-mini');

    expect(result).toEqual({
      reportPath: '.temp/reports/2026-01-01T00-00-00.txt',
      bucketCounts: { ham: 1, marketing: 0, spam: 1 },
    });
  });

  test('honors the given reportsDir', async () => {
    loadEmlDataset.mockResolvedValue({ bucketNames: [], messages: [] });

    await runPromptEval(
      {
        bucketPaths: { spam: '.temp/messages/spam' },
        reportsDir: '/tmp/custom-reports',
      },
      fixtureContext()
    );

    expect(writeReport).toHaveBeenCalledWith(
      '/tmp/custom-reports',
      expect.any(String),
      expect.any(Date)
    );
  });

  test('supports a partial set of buckets (e.g. just one folder given)', async () => {
    loadEmlDataset.mockResolvedValue({
      bucketNames: ['spam'],
      messages: [makeMessage('spam', 'only.eml')],
    });
    classifyEmail.mockResolvedValue({ score: 90, reasoning: 'phishing' });

    const result = await runPromptEval(
      {
        bucketPaths: { spam: '.temp/messages/spam' },
        reportsDir: '.temp/reports',
      },
      fixtureContext()
    );

    expect(loadEmlDataset).toHaveBeenCalledWith({
      spam: '.temp/messages/spam',
    });
    expect(result.bucketCounts).toEqual({ spam: 1 });
  });
});
