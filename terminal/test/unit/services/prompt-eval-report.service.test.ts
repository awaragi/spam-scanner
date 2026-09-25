import { describe, test, expect } from 'vitest';
import { formatPromptEvalReport } from '../../../src/lib/services/prompt-eval-report.service.ts';

function baseConfig(overrides = {}) {
  return {
    model: 'gpt-4o-mini',
    maxInputTokens: 6000,
    maxOutputTokens: 2000,
    concurrency: 5,
    escalateToLowThreshold: 50,
    escalateToHighThreshold: 80,
    ...overrides,
  };
}

describe('formatPromptEvalReport', () => {
  test('includes the config snapshot in the header', () => {
    const report = formatPromptEvalReport({
      bucketNames: [],
      results: [],
      config: baseConfig({ model: 'gpt-5-mini' }),
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report).toContain('generated: 2026-01-01T00:00:00.000Z');
    expect(report).toContain('model: gpt-5-mini');
    expect(report).toContain('maxInputTokens: 6000');
    expect(report).toContain('escalateToLowThreshold: 50');
    expect(report).toContain('escalateToHighThreshold: 80');
  });

  test('lists every entry in a bucket and computes summary stats', () => {
    const report = formatPromptEvalReport({
      bucketNames: ['ham'],
      results: [
        {
          bucket: 'ham',
          filename: 'a.eml',
          score: 10,
          reasoning: 'fine',
          error: null,
        },
        {
          bucket: 'ham',
          filename: 'b.eml',
          score: 20,
          reasoning: 'ok',
          error: null,
        },
        {
          bucket: 'ham',
          filename: 'c.eml',
          score: 90,
          reasoning: 'suspicious',
          error: null,
        },
      ],
      config: baseConfig(),
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report).toContain('== ham (3) ==');
    expect(report).toContain('a.eml\tscore=10\t"fine"');
    expect(report).toContain('b.eml\tscore=20\t"ok"');
    expect(report).toContain('c.eml\tscore=90\t"suspicious"');
    expect(report).toContain('summary: count=3 avg=40.0 min=10 max=90');
  });

  test('renders a bucket with zero entries without error', () => {
    const report = formatPromptEvalReport({
      bucketNames: ['marketing'],
      results: [],
      config: baseConfig(),
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report).toContain('== marketing (0) ==');
    expect(report).toContain('summary: (no messages)');
  });

  test('shows a failed entry distinctly from a scored one and excludes it from stats', () => {
    const report = formatPromptEvalReport({
      bucketNames: ['spam'],
      results: [
        {
          bucket: 'spam',
          filename: 'a.eml',
          score: 95,
          reasoning: 'phishing',
          error: null,
        },
        {
          bucket: 'spam',
          filename: 'b.eml',
          score: null,
          reasoning: null,
          error: 'provider timeout',
        },
      ],
      config: baseConfig(),
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report).toContain('a.eml\tscore=95\t"phishing"');
    expect(report).toContain('b.eml\tERROR\t"provider timeout"');
    expect(report).toContain(
      'summary: count=1 avg=95.0 min=95 max=95 failed=1'
    );
  });

  test('renders multiple buckets in the order given', () => {
    const report = formatPromptEvalReport({
      bucketNames: ['ham', 'marketing', 'spam'],
      results: [
        {
          bucket: 'ham',
          filename: 'a.eml',
          score: 5,
          reasoning: 'ok',
          error: null,
        },
        {
          bucket: 'spam',
          filename: 'z.eml',
          score: 99,
          reasoning: 'scam',
          error: null,
        },
      ],
      config: baseConfig(),
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const hamIndex = report.indexOf('== ham');
    const marketingIndex = report.indexOf('== marketing');
    const spamIndex = report.indexOf('== spam');
    expect(hamIndex).toBeGreaterThanOrEqual(0);
    expect(marketingIndex).toBeGreaterThan(hamIndex);
    expect(spamIndex).toBeGreaterThan(marketingIndex);
  });
});
